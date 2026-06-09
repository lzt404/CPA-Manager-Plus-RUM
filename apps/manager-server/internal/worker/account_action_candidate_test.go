package worker

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	collectorpkg "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/collector"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestAccountActionCandidateFromEventUsesSafeEvidence(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	event := usage.Event{
		Failed:                true,
		FailStatusCode:        401,
		EventHash:             "evt-auth",
		RequestID:             "req-1",
		Provider:              "codex",
		AuthFileSnapshot:      "codex-auth.json",
		AuthIndex:             "7",
		AccountSnapshot:       "user@example.com",
		AuthProjectIDSnapshot: "acct-123",
		FailSummary:           "authentication_error: invalidated OAuth token",
		FailBody:              `{"error":{"type":"authentication_error","code":"token_revoked","message":"secret token sk-sensitive"}}`,
		RawJSON:               `{"authorization":"Bearer secret","raw":"payload"}`,
	}
	candidate, ok := accountActionCandidateFromEvent(event, "http://cpa.local", "mgmt", now)
	if !ok {
		t.Fatal("candidate not detected")
	}
	if candidate.ActionType != model.AccountActionTypeDelete {
		t.Fatalf("action type = %q", candidate.ActionType)
	}
	if candidate.AccountID != "acct-123" {
		t.Fatalf("account id = %q", candidate.AccountID)
	}
	if strings.Contains(candidate.EvidenceJSON, "FailBody") || strings.Contains(candidate.EvidenceJSON, "RawJSON") || strings.Contains(candidate.EvidenceJSON, "sk-sensitive") || strings.Contains(candidate.EvidenceJSON, "Bearer secret") {
		t.Fatalf("evidence leaked sensitive raw payload: %s", candidate.EvidenceJSON)
	}
	var evidence map[string]any
	if err := json.Unmarshal([]byte(candidate.EvidenceJSON), &evidence); err != nil {
		t.Fatalf("decode evidence: %v", err)
	}
	if evidence["errorCode"] != "token_revoked" || evidence["errorType"] != "authentication_error" {
		t.Fatalf("evidence = %#v", evidence)
	}
}

func TestAccountActionCandidateWorkerSavesWithoutAutoDisable(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/usage.sqlite")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	worker := NewAccountActionCandidateWorker(st, false)
	event := usage.Event{
		Failed:           true,
		FailStatusCode:   401,
		EventHash:        "evt-auth",
		Provider:         "codex",
		AuthFileSnapshot: "codex-auth.json",
		AuthIndex:        "7",
		FailSummary:      "invalidated OAuth token",
	}
	candidate, ok := accountActionCandidateFromEvent(event, "http://cpa.local", "mgmt", time.Now())
	if !ok {
		t.Fatal("candidate not detected")
	}
	worker.handleCandidate(context.Background(), candidate)

	items, err := st.ListAccountActionCandidates(context.Background(), model.AccountActionStatusPending, 10)
	if err != nil {
		t.Fatalf("list candidates: %v", err)
	}
	if len(items) != 1 || items[0].AuthFileName != "codex-auth.json" || items[0].ActionType != model.AccountActionTypeDelete {
		t.Fatalf("items = %#v", items)
	}
}

func TestUsageEventFanoutCallsHandlers(t *testing.T) {
	first := &recordingUsageHandler{}
	second := &recordingUsageHandler{}
	fanout := NewUsageEventFanout(first, nil, second)
	fanout.HandleUsageEvents(context.Background(), collectorpkg.RuntimeConfig{CPAUpstreamURL: "http://cpa"}, []usage.Event{{EventHash: "evt"}})
	if first.count != 1 || second.count != 1 {
		t.Fatalf("counts = %d/%d", first.count, second.count)
	}
}

type recordingUsageHandler struct{ count int }

func (h *recordingUsageHandler) HandleUsageEvents(context.Context, collectorpkg.RuntimeConfig, []usage.Event) {
	h.count++
}

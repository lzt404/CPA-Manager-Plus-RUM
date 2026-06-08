import { act, createElement, createRef, useImperativeHandle, type Ref } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { useVisualConfig } from './useVisualConfig';

type UseVisualConfigResult = ReturnType<typeof useVisualConfig>;

type UseVisualConfigHarness = {
  getCurrent: () => UseVisualConfigResult;
  unmount: () => void;
};

function HookHarness({ hookRef }: { hookRef: Ref<UseVisualConfigResult> }) {
  const hook = useVisualConfig();
  useImperativeHandle(hookRef, () => hook, [hook]);
  return null;
}

const mountUseVisualConfig = (): UseVisualConfigHarness => {
  const hookRef = createRef<UseVisualConfigResult>();
  let renderer: ReactTestRenderer | null = null;

  act(() => {
    renderer = create(createElement(HookHarness, { hookRef }));
  });

  return {
    getCurrent: () => {
      if (!hookRef.current) {
        throw new Error('Failed to mount useVisualConfig test harness');
      }
      return hookRef.current;
    },
    unmount: () => {
      if (!renderer) return;
      act(() => {
        renderer?.unmount();
      });
    },
  };
};

describe('useVisualConfig', () => {
  it('clears camelCase codex identityConfuse when disabling from visual editor', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'host: 127.0.0.1',
      'codex:',
      '  identityConfuse: true',
      '  other-setting: kept',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });
    expect(harness.getCurrent().visualValues.codexIdentityConfuse).toBe(true);

    act(() => {
      harness.getCurrent().setVisualValues({ codexIdentityConfuse: false });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).not.toContain('identityConfuse: true');
    expect(savedYaml).not.toContain('identityConfuse:');
    expect(savedYaml).toContain('identity-confuse: false');
    expect(savedYaml).toContain('other-setting: kept');

    harness.unmount();
  });

  it('parses inline API key access rules from api-keys entries', () => {
    const harness = mountUseVisualConfig();

    act(() => {
      harness.getCurrent().loadVisualValuesFromYaml(`
api-keys:
  - api-key: client-a
    allowed-auth-indexes:
      - idx-a
      - idx-b
  - api-key: client-b
    allowed-auth-ids:
      - auth-b
  - client-c
`);
    });

    expect(harness.getCurrent().visualValues.apiKeysText).toBe('client-a\nclient-b\nclient-c');
    expect(harness.getCurrent().visualValues.apiKeyAccessRules).toMatchObject([
      {
        apiKey: 'client-a',
        allowedAuthIndexesText: 'idx-a\nidx-b',
        allowedAuthIdsText: '',
      },
      {
        apiKey: 'client-b',
        allowedAuthIndexesText: '',
        allowedAuthIdsText: 'auth-b',
      },
      {
        apiKey: 'client-c',
        allowedAuthIndexesText: '',
        allowedAuthIdsText: '',
      },
    ]);

    harness.unmount();
  });

  it('serializes access rules inline and removes legacy api-key-access-rules', () => {
    const harness = mountUseVisualConfig();
    const source = `
api-keys:
  - client-a
  - client-b
api-key-access-rules:
  - api-key: client-a
    allowed-auth-indexes:
      - old-idx
`;

    act(() => {
      harness.getCurrent().loadVisualValuesFromYaml(source);
    });
    act(() => {
      harness.getCurrent().setVisualValues({
        apiKeyAccessRules: [
          {
            id: 'client-a-rule',
            apiKey: 'client-a',
            allowedAuthIndexesText: 'idx-a\nidx-b',
            allowedAuthIdsText: '',
          },
          {
            id: 'client-b-rule',
            apiKey: 'client-b',
            allowedAuthIndexesText: '',
            allowedAuthIdsText: '',
          },
        ],
      });
    });

    const output = harness.getCurrent().applyVisualChangesToYaml(source);
    const parsed = parseYaml(output) as {
      'api-keys': Array<Record<string, unknown>>;
      'api-key-access-rules'?: unknown;
    };

    expect(parsed['api-key-access-rules']).toBeUndefined();
    expect(parsed['api-keys']).toEqual([
      {
        'api-key': 'client-a',
        'allowed-auth-indexes': ['idx-a', 'idx-b'],
      },
      {
        'api-key': 'client-b',
      },
    ]);

    harness.unmount();
  });

  it('prefers inline camelCase rules over legacy rules and parses scalar lists', () => {
    const harness = mountUseVisualConfig();

    act(() => {
      harness.getCurrent().loadVisualValuesFromYaml(`
api-keys:
  - apiKey: client-a
    allowedAuthIndexes: "inline-a, inline-b, inline-a"
    allowedAuthIds: "auth-a, auth-b"
api-key-access-rules:
  - api-key: client-a
    allowed-auth-indexes:
      - legacy-a
`);
    });

    expect(harness.getCurrent().visualValues.apiKeyAccessRules).toMatchObject([
      {
        apiKey: 'client-a',
        allowedAuthIndexesText: 'inline-a\ninline-b',
        allowedAuthIdsText: 'auth-a\nauth-b',
      },
    ]);

    harness.unmount();
  });
});

import { memo, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { usageServiceApi, type ApiKeyAlias } from '@/services/api/usageService';
import { authFilesApi } from '@/services/api/authFiles';
import { providersApi } from '@/services/api/providers';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { usePanelFeatureAvailability } from '@/hooks/usePanelFeatureAvailability';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { sha256Hex } from '@/utils/apiKeyHash';
import { isValidApiKeyCharset } from '@/utils/validation';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { AuthFileItem } from '@/types/authFile';
import type { Config } from '@/types/config';
import type { ApiKeyAccessRule } from '@/types/visualConfig';
import { makeClientId } from '@/types/visualConfig';
import styles from './VisualConfigEditor.module.scss';

type OrphanAliasConflict = {
  apiKeyHash: string;
  alias: string;
};

type AuthIndexOption = {
  value: string;
  label: string;
  searchText: string;
};

type AuthIndexSourceConfig = Partial<
  Pick<
    Config,
    'geminiApiKeys' | 'codexApiKeys' | 'claudeApiKeys' | 'vertexApiKeys' | 'openaiCompatibility'
  >
>;

function readAuthOptionText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function readAuthOptionRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readAuthOptionField(value: unknown, key: string): unknown {
  return readAuthOptionRecord(value)?.[key];
}

function firstAuthOptionText(...values: unknown[]): string {
  for (const value of values) {
    const text = readAuthOptionText(value);
    if (text) return text;
  }
  return '';
}

function readAuthOptionBaseName(value: unknown): string {
  const text = readAuthOptionText(value);
  if (!text) return '';
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || text;
}

function appendAuthOptionPart(parts: string[], value: unknown) {
  const text = readAuthOptionText(value);
  if (!text) return;
  const key = text.toLowerCase();
  if (parts.some((part) => part.toLowerCase() === key)) return;
  parts.push(text);
}

function compactAuthOptionText(value: string, maxLength = 38): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  if (text.includes('@')) {
    const [name, domain] = text.split('@');
    if (name && domain) {
      const compactName = name.length > 14 ? `${name.slice(0, 6)}...${name.slice(-4)}` : name;
      const compactDomain =
        domain.length > 18 ? `${domain.slice(0, 8)}...${domain.slice(-7)}` : domain;
      return `${compactName}@${compactDomain}`;
    }
  }
  return `${text.slice(0, 18)}...${text.slice(-10)}`;
}

function buildReadableAuthIndexOption(
  authIndex: string,
  labelParts: Array<unknown>,
  label?: string
): AuthIndexOption {
  const parts: string[] = [];
  labelParts.forEach((part) => appendAuthOptionPart(parts, part));
  const detail = parts.length > 0 ? parts.join(' / ') : 'Credential';
  const displayLabel = readAuthOptionText(label) || parts[0] || `#${authIndex}`;

  return {
    value: authIndex,
    label: compactAuthOptionText(displayLabel, 42),
    searchText: `${displayLabel} ${detail} ${authIndex}`,
  };
}

function buildAuthFileOptionLabel(file: AuthFileItem): string {
  return (
    readAuthOptionBaseName(file.name) ||
    readAuthOptionBaseName(file.filename) ||
    readAuthOptionBaseName(file.path) ||
    readAuthOptionText(file.provider ?? file.type) ||
    'OAuth'
  );
}

function buildAuthFileLabelParts(file: AuthFileItem): string[] {
  const idToken = file.id_token;
  const profile = readAuthOptionRecord(file.profile);
  const profileUser = readAuthOptionField(profile, 'user');
  const profileAccount = readAuthOptionField(profile, 'account');
  const account = firstAuthOptionText(
    file.account,
    file.email,
    readAuthOptionField(idToken, 'email'),
    readAuthOptionField(profileUser, 'email'),
    readAuthOptionField(profile, 'email'),
    file.client_email
  );
  const accountID = firstAuthOptionText(
    file.account_id,
    file.accountId,
    file.chatgpt_account_id,
    file.chatgptAccountId,
    readAuthOptionField(idToken, 'account_id'),
    readAuthOptionField(idToken, 'accountId'),
    readAuthOptionField(idToken, 'chatgpt_account_id'),
    readAuthOptionField(idToken, 'chatgptAccountId'),
    readAuthOptionField(profileAccount, 'id'),
    readAuthOptionField(profileAccount, 'account_id'),
    readAuthOptionField(profileAccount, 'accountId'),
    readAuthOptionField(profileAccount, 'chatgpt_account_id'),
    readAuthOptionField(profileAccount, 'chatgptAccountId')
  );
  const projectID = firstAuthOptionText(
    file.project_id,
    file.projectId,
    file.gemini_virtual_project,
    file.geminiVirtualProject
  );
  const parts: string[] = [];
  appendAuthOptionPart(parts, file.provider ?? file.type ?? 'OAuth');
  appendAuthOptionPart(parts, account);
  appendAuthOptionPart(parts, accountID);
  appendAuthOptionPart(parts, projectID);
  appendAuthOptionPart(parts, file.label);
  appendAuthOptionPart(parts, file.name);
  if (file.disabled) appendAuthOptionPart(parts, 'disabled');
  return parts;
}

function addAuthIndexOption(
  optionsByValue: Map<string, AuthIndexOption>,
  value: unknown,
  labelParts: Array<unknown>,
  label?: string
) {
  const authIndex = normalizeAuthIndex(value);
  if (!authIndex || optionsByValue.has(authIndex)) return;
  optionsByValue.set(authIndex, buildReadableAuthIndexOption(authIndex, labelParts, label));
}

function addConfigAuthIndexOptions(
  optionsByValue: Map<string, AuthIndexOption>,
  config: AuthIndexSourceConfig | null | undefined
) {
  config?.geminiApiKeys?.forEach((entry, index) => {
    const label = `Gemini ${entry.prefix || entry.baseUrl || `key ${index + 1}`}`;
    addAuthIndexOption(
      optionsByValue,
      entry.authIndex,
      ['Gemini', entry.prefix || entry.baseUrl || `key ${index + 1}`, entry.baseUrl],
      label
    );
  });
  config?.codexApiKeys?.forEach((entry, index) => {
    const label = `Codex ${entry.prefix || entry.baseUrl || `key ${index + 1}`}`;
    addAuthIndexOption(
      optionsByValue,
      entry.authIndex,
      ['Codex', entry.prefix || entry.baseUrl || `key ${index + 1}`, entry.baseUrl],
      label
    );
  });
  config?.claudeApiKeys?.forEach((entry, index) => {
    const label = `Claude ${entry.prefix || entry.baseUrl || `key ${index + 1}`}`;
    addAuthIndexOption(
      optionsByValue,
      entry.authIndex,
      ['Claude', entry.prefix || entry.baseUrl || `key ${index + 1}`, entry.baseUrl],
      label
    );
  });
  config?.vertexApiKeys?.forEach((entry, index) => {
    const label = `Vertex ${entry.prefix || entry.baseUrl || `key ${index + 1}`}`;
    addAuthIndexOption(
      optionsByValue,
      entry.authIndex,
      ['Vertex', entry.prefix || entry.baseUrl || `key ${index + 1}`, entry.baseUrl],
      label
    );
  });
  config?.openaiCompatibility?.forEach((provider) => {
    const providerName = provider.name || provider.prefix || provider.baseUrl || 'provider';
    addAuthIndexOption(
      optionsByValue,
      provider.authIndex,
      ['OpenAI', providerName, provider.baseUrl],
      `OpenAI ${providerName}`
    );
    provider.apiKeyEntries?.forEach((entry, index) => {
      addAuthIndexOption(
        optionsByValue,
        entry.authIndex,
        ['OpenAI', providerName, provider.baseUrl, `key ${index + 1}`],
        `OpenAI ${providerName} key ${index + 1}`
      );
    });
  });
}

function buildAuthIndexOptions(
  config: Config | null | undefined,
  authFiles: AuthFileItem[],
  providerAuthConfig: AuthIndexSourceConfig | null | undefined
) {
  const optionsByValue = new Map<string, AuthIndexOption>();

  authFiles.forEach((file) => {
    addAuthIndexOption(
      optionsByValue,
      file.authIndex ?? file.auth_index,
      buildAuthFileLabelParts(file),
      buildAuthFileOptionLabel(file)
    );
  });

  addConfigAuthIndexOptions(optionsByValue, config);
  addConfigAuthIndexOptions(optionsByValue, providerAuthConfig);

  return Array.from(optionsByValue.values()).sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
  );
}

function splitAccessRuleListText(value: string): string[] {
  const items = value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

export const ApiKeysCardEditor = memo(function ApiKeysCardEditor({
  value,
  accessRules,
  disabled,
  onChange,
  onAccessRulesChange,
}: {
  value: string;
  accessRules: ApiKeyAccessRule[];
  disabled?: boolean;
  onChange: (nextValue: string) => void;
  onAccessRulesChange: (nextValue: ApiKeyAccessRule[]) => void;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const featureAvailability = usePanelFeatureAvailability();
  const apiKeys = useMemo(
    () =>
      value
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean),
    [value]
  );
  const [apiKeyIds, setApiKeyIds] = useState(() => apiKeys.map(() => makeClientId()));
  const renderApiKeyIds = useMemo(() => {
    if (apiKeyIds.length === apiKeys.length) return apiKeyIds;
    if (apiKeyIds.length > apiKeys.length) return apiKeyIds.slice(0, apiKeys.length);
    return [
      ...apiKeyIds,
      ...Array.from({ length: apiKeys.length - apiKeyIds.length }, () => makeClientId()),
    ];
  }, [apiKeyIds, apiKeys.length]);

  const apiKeyInputId = useId();
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;
  const keyAliasInputId = `${apiKeyInputId}-alias`;
  const aliasModalInputId = useId();
  const aliasModalErrorId = `${aliasModalInputId}-error`;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [inputAliasValue, setInputAliasValue] = useState('');
  const [formError, setFormError] = useState('');
  const [apiKeyAliases, setApiKeyAliases] = useState<ApiKeyAlias[]>([]);
  const [aliasesLoading, setAliasesLoading] = useState(false);
  const [aliasesAvailable, setAliasesAvailable] = useState(false);
  const [aliasModalOpen, setAliasModalOpen] = useState(false);
  const [aliasEditingApiKeyId, setAliasEditingApiKeyId] = useState<string | null>(null);
  const [aliasInputValue, setAliasInputValue] = useState('');
  const [aliasFormError, setAliasFormError] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [accessEditingApiKeyId, setAccessEditingApiKeyId] = useState<string | null>(null);
  const [accessAllowedIndexesValue, setAccessAllowedIndexesValue] = useState('');
  const [accessAllowedIdsValue, setAccessAllowedIdsValue] = useState('');
  const [selectedAuthIndex, setSelectedAuthIndex] = useState('');
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);
  const [authFilesLoading, setAuthFilesLoading] = useState(false);
  const [providerAuthConfig, setProviderAuthConfig] = useState<AuthIndexSourceConfig | null>(null);
  const [providerAuthLoading, setProviderAuthLoading] = useState(false);

  const aliasByHash = useMemo(() => {
    const map = new Map<string, ApiKeyAlias>();
    apiKeyAliases.forEach((item) => {
      const hash = String(item.apiKeyHash || '')
        .trim()
        .toLowerCase();
      const alias = String(item.alias || '').trim();
      if (!hash || !alias) return;
      map.set(hash, { ...item, apiKeyHash: hash, alias });
    });
    return map;
  }, [apiKeyAliases]);

  const accessRuleByKey = useMemo(() => {
    const map = new Map<string, ApiKeyAccessRule>();
    accessRules.forEach((rule) => {
      const key = rule.apiKey.trim();
      if (key && !map.has(key)) map.set(key, rule);
    });
    return map;
  }, [accessRules]);

  const normalizeAccessRulesForKeys = useCallback((keys: string[], rules: ApiKeyAccessRule[]) => {
    const byKey = new Map<string, ApiKeyAccessRule>();
    rules.forEach((rule) => {
      const key = rule.apiKey.trim();
      if (key && !byKey.has(key)) byKey.set(key, rule);
    });
    return keys
      .map((key, index) => {
        const trimmed = key.trim();
        if (!trimmed) return null;
        const existing = byKey.get(trimmed);
        return (
          existing ?? {
            id: `api-key-access-rule-${index}-${trimmed}`,
            apiKey: trimmed,
            allowedAuthIndexesText: '',
            allowedAuthIdsText: '',
          }
        );
      })
      .filter((rule): rule is ApiKeyAccessRule => Boolean(rule));
  }, []);

  const getAccessRuleForApiKey = (apiKey: string) =>
    accessRuleByKey.get(apiKey.trim()) ?? {
      id: `api-key-access-rule-${apiKey}`,
      apiKey,
      allowedAuthIndexesText: '',
      allowedAuthIdsText: '',
    };

  const getAllowedCount = (rule: ApiKeyAccessRule) =>
    splitAccessRuleListText(rule.allowedAuthIndexesText).length +
    splitAccessRuleListText(rule.allowedAuthIdsText).length;

  const authIndexOptions = useMemo(
    () => buildAuthIndexOptions(config, authFiles, providerAuthConfig),
    [authFiles, config, providerAuthConfig]
  );
  const authIndexOptionsLoading = authFilesLoading || providerAuthLoading;
  const authIndexOptionByValue = useMemo(
    () => new Map(authIndexOptions.map((option) => [option.value, option])),
    [authIndexOptions]
  );
  const allowedAuthIndexes = useMemo(
    () => splitAccessRuleListText(accessAllowedIndexesValue),
    [accessAllowedIndexesValue]
  );
  const allowedAuthIds = useMemo(
    () => splitAccessRuleListText(accessAllowedIdsValue),
    [accessAllowedIdsValue]
  );
  const activeAccessApiKey = useMemo(() => {
    const accessEditingIndex = accessEditingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === accessEditingApiKeyId)
      : -1;
    if (accessEditingIndex >= 0) {
      return apiKeys[accessEditingIndex] ?? '';
    }

    const editingIndex = editingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId)
      : -1;
    return editingIndex >= 0 ? (apiKeys[editingIndex] ?? '') : '';
  }, [accessEditingApiKeyId, apiKeys, editingApiKeyId, renderApiKeyIds]);
  const authIndexesUsedByOtherKeys = useMemo(() => {
    const activeKey = activeAccessApiKey.trim();
    const used = new Set<string>();
    accessRules.forEach((rule) => {
      const ruleKey = rule.apiKey.trim();
      if (activeKey && ruleKey === activeKey) return;
      splitAccessRuleListText(rule.allowedAuthIndexesText).forEach((authIndex) =>
        used.add(authIndex)
      );
    });
    return used;
  }, [accessRules, activeAccessApiKey]);
  const unusedAuthIndexOptions = useMemo(() => {
    const current = new Set(allowedAuthIndexes);
    return authIndexOptions.filter(
      (option) => !current.has(option.value) && !authIndexesUsedByOtherKeys.has(option.value)
    );
  }, [allowedAuthIndexes, authIndexOptions, authIndexesUsedByOtherKeys]);
  const unselectedAuthIndexOptions = useMemo(() => {
    const current = new Set(allowedAuthIndexes);
    return authIndexOptions.filter((option) => !current.has(option.value));
  }, [allowedAuthIndexes, authIndexOptions]);

  const resolveAliasServiceBase = useCallback(
    async (): Promise<string> =>
      featureAvailability.managerServiceAvailable ? featureAvailability.managerServiceBase : '',
    [featureAvailability.managerServiceAvailable, featureAvailability.managerServiceBase]
  );

  useEffect(() => {
    let cancelled = false;

    const loadAliases = async () => {
      setAliasesLoading(true);
      try {
        const serviceBase = await resolveAliasServiceBase();
        if (cancelled) return;
        if (!serviceBase) {
          setAliasesAvailable(false);
          setApiKeyAliases([]);
          return;
        }
        const response = await usageServiceApi.getApiKeyAliases(serviceBase, managementKey);
        if (cancelled) return;
        setAliasesAvailable(true);
        setApiKeyAliases(Array.isArray(response.items) ? response.items : []);
      } catch {
        if (cancelled) return;
        setAliasesAvailable(false);
        setApiKeyAliases([]);
      } finally {
        if (!cancelled) {
          setAliasesLoading(false);
        }
      }
    };

    void loadAliases();

    return () => {
      cancelled = true;
    };
  }, [managementKey, resolveAliasServiceBase]);

  useEffect(() => {
    if (!accessModalOpen && !modalOpen) return;
    let cancelled = false;

    const loadAuthFiles = async () => {
      setAuthFilesLoading(true);
      try {
        const response = await authFilesApi.list();
        if (!cancelled) {
          setAuthFiles(Array.isArray(response.files) ? response.files : []);
        }
      } catch {
        if (!cancelled) {
          setAuthFiles([]);
        }
      } finally {
        if (!cancelled) {
          setAuthFilesLoading(false);
        }
      }
    };

    void loadAuthFiles();

    return () => {
      cancelled = true;
    };
  }, [accessModalOpen, modalOpen]);

  useEffect(() => {
    if (!accessModalOpen && !modalOpen) return;
    let cancelled = false;

    const loadProviderAuthConfig = async () => {
      setProviderAuthLoading(true);
      try {
        const [gemini, codex, claude, vertex, openai] = await Promise.allSettled([
          providersApi.getGeminiKeys(),
          providersApi.getCodexConfigs(),
          providersApi.getClaudeConfigs(),
          providersApi.getVertexConfigs(),
          providersApi.getOpenAIProviders(),
        ] as const);
        if (cancelled) return;

        const next: AuthIndexSourceConfig = {};
        if (gemini.status === 'fulfilled') next.geminiApiKeys = gemini.value;
        if (codex.status === 'fulfilled') next.codexApiKeys = codex.value;
        if (claude.status === 'fulfilled') next.claudeApiKeys = claude.value;
        if (vertex.status === 'fulfilled') next.vertexApiKeys = vertex.value;
        if (openai.status === 'fulfilled') next.openaiCompatibility = openai.value;
        setProviderAuthConfig(next);
      } finally {
        if (!cancelled) {
          setProviderAuthLoading(false);
        }
      }
    };

    void loadProviderAuthConfig();

    return () => {
      cancelled = true;
    };
  }, [accessModalOpen, modalOpen]);

  function generateSecureApiKey(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(64);
    crypto.getRandomValues(array);
    return 'sk-' + Array.from(array, (b) => charset[b % charset.length]).join('');
  }

  const getApiKeyHash = (apiKey: string) => sha256Hex(apiKey).toLowerCase();

  const getAliasForApiKey = (apiKey: string) => {
    const hash = getApiKeyHash(apiKey);
    return hash ? (aliasByHash.get(hash)?.alias ?? '') : '';
  };

  const collectActiveApiKeyHashes = (keys: string[]) =>
    Array.from(
      new Set(
        keys
          .map((key) => getApiKeyHash(key))
          .map((hash) => hash.trim().toLowerCase())
          .filter(Boolean)
      )
    );

  const normalizeAliasKey = (alias: string) => alias.trim().toLowerCase();

  const isDuplicateAlias = (
    alias: string,
    currentApiKeyHash: string,
    activeApiKeyHashes?: string[]
  ) => {
    const aliasKey = normalizeAliasKey(alias);
    const currentHash = currentApiKeyHash.trim().toLowerCase();
    const activeHashSet =
      activeApiKeyHashes && activeApiKeyHashes.length > 0
        ? new Set(activeApiKeyHashes.map((hash) => hash.trim().toLowerCase()).filter(Boolean))
        : null;
    if (!aliasKey) return false;
    return apiKeyAliases.some((item) => {
      const itemHash = String(item.apiKeyHash || '')
        .trim()
        .toLowerCase();
      if (activeHashSet && !activeHashSet.has(itemHash)) return false;
      return itemHash !== currentHash && normalizeAliasKey(String(item.alias || '')) === aliasKey;
    });
  };

  const findOrphanAliasConflict = (
    alias: string,
    currentApiKeyHash: string,
    activeApiKeyHashes?: string[]
  ): OrphanAliasConflict | null => {
    const aliasKey = normalizeAliasKey(alias);
    const currentHash = currentApiKeyHash.trim().toLowerCase();
    if (!aliasKey || !activeApiKeyHashes || activeApiKeyHashes.length === 0) return null;

    const activeHashSet = new Set(
      activeApiKeyHashes.map((hash) => hash.trim().toLowerCase()).filter(Boolean)
    );

    for (const item of apiKeyAliases) {
      const itemHash = String(item.apiKeyHash || '')
        .trim()
        .toLowerCase();
      const itemAlias = String(item.alias || '').trim();
      if (!itemHash || itemHash === currentHash || activeHashSet.has(itemHash)) continue;
      if (normalizeAliasKey(itemAlias) === aliasKey) {
        return { apiKeyHash: itemHash, alias: itemAlias };
      }
    }

    return null;
  };

  const requestOrphanAliasCleanup = async (
    alias: string,
    currentApiKeyHash: string,
    activeApiKeyHashes?: string[]
  ): Promise<{ shouldContinue: boolean; allowOrphanAliasCleanup: boolean }> => {
    const conflict = findOrphanAliasConflict(alias, currentApiKeyHash, activeApiKeyHashes);
    if (!conflict) {
      return { shouldContinue: true, allowOrphanAliasCleanup: false };
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('config_management.visual.api_keys.alias_cleanup_title'),
        message: (
          <>
            <p style={{ margin: '0 0 0.75rem' }}>
              {t('config_management.visual.api_keys.alias_cleanup_confirm', {
                alias: conflict.alias,
              })}
            </p>
            <p style={{ margin: 0 }}>
              {t('config_management.visual.api_keys.alias_cleanup_risk', {
                hash: conflict.apiKeyHash.slice(0, 12),
              })}
            </p>
          </>
        ),
        confirmText: t('config_management.visual.api_keys.alias_cleanup_confirm_action'),
        variant: 'danger',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

    return { shouldContinue: confirmed, allowOrphanAliasCleanup: confirmed };
  };

  const validateAlias = (
    alias: string,
    currentApiKeyHash: string = '',
    activeApiKeyHashes?: string[]
  ) => {
    const trimmed = alias.trim();
    if (!trimmed) {
      return t('config_management.visual.api_keys.alias_error_empty');
    }
    if (Array.from(trimmed).length > 120) {
      return t('config_management.visual.api_keys.alias_error_too_long');
    }
    if (isDuplicateAlias(trimmed, currentApiKeyHash, activeApiKeyHashes)) {
      return t('config_management.visual.api_keys.alias_error_duplicate');
    }
    return '';
  };

  const saveAliasForKey = async (
    apiKey: string,
    alias: string,
    activeApiKeyHashes?: string[],
    allowOrphanAliasCleanup = false
  ) => {
    const apiKeyHash = getApiKeyHash(apiKey);
    const trimmedAlias = alias.trim();
    if (!apiKeyHash) {
      throw new Error(t('config_management.visual.api_keys.error_empty'));
    }
    const validationError = validateAlias(trimmedAlias, apiKeyHash, activeApiKeyHashes);
    if (validationError) {
      throw new Error(validationError);
    }

    const serviceBase = await resolveAliasServiceBase();
    if (!serviceBase) {
      throw new Error(t('config_management.visual.api_keys.alias_unavailable'));
    }

    const response = await usageServiceApi.saveApiKeyAliases(
      serviceBase,
      [{ apiKeyHash, alias: trimmedAlias }],
      managementKey,
      activeApiKeyHashes,
      allowOrphanAliasCleanup
    );
    setAliasesAvailable(true);
    setApiKeyAliases(Array.isArray(response.items) ? response.items : []);
  };

  const deleteAliasForHash = async (apiKeyHash: string) => {
    const serviceBase = await resolveAliasServiceBase();
    if (!serviceBase) {
      throw new Error(t('config_management.visual.api_keys.alias_unavailable'));
    }

    await usageServiceApi.deleteApiKeyAlias(serviceBase, apiKeyHash, managementKey);
    setApiKeyAliases((previous) =>
      previous.filter((item) => item.apiKeyHash.toLowerCase() !== apiKeyHash.toLowerCase())
    );
  };

  const getAliasErrorMessage = (error: unknown) => {
    if (
      error &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'api_key_alias_duplicate'
    ) {
      return t('config_management.visual.api_keys.alias_error_duplicate');
    }
    return error instanceof Error ? error.message : String(error);
  };

  const openAddModal = () => {
    setEditingApiKeyId(null);
    setInputValue('');
    setInputAliasValue('');
    setAccessAllowedIndexesValue('');
    setAccessAllowedIdsValue('');
    setSelectedAuthIndex('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (apiKeyId: string) => {
    const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    const editingKey = apiKeys[editingIndex] ?? '';
    const rule = getAccessRuleForApiKey(editingKey);
    setEditingApiKeyId(apiKeyId);
    setInputValue(editingKey);
    setInputAliasValue(getAliasForApiKey(editingKey));
    setAccessAllowedIndexesValue(rule.allowedAuthIndexesText);
    setAccessAllowedIdsValue(rule.allowedAuthIdsText);
    setSelectedAuthIndex('');
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setInputAliasValue('');
    setEditingApiKeyId(null);
    setAccessAllowedIndexesValue('');
    setAccessAllowedIdsValue('');
    setSelectedAuthIndex('');
    setFormError('');
  };

  const openAliasModal = (apiKeyId: string) => {
    const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    const editingKey = apiKeys[editingIndex] ?? '';
    setAliasEditingApiKeyId(apiKeyId);
    setAliasInputValue(getAliasForApiKey(editingKey));
    setAliasFormError('');
    setAliasModalOpen(true);
  };

  const closeAliasModal = () => {
    setAliasModalOpen(false);
    setAliasEditingApiKeyId(null);
    setAliasInputValue('');
    setAliasFormError('');
  };

  const openAccessModal = (apiKeyId: string) => {
    const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    const editingKey = apiKeys[editingIndex] ?? '';
    const rule = getAccessRuleForApiKey(editingKey);
    setAccessEditingApiKeyId(apiKeyId);
    setAccessAllowedIndexesValue(rule.allowedAuthIndexesText);
    setAccessAllowedIdsValue(rule.allowedAuthIdsText);
    setSelectedAuthIndex('');
    setAccessModalOpen(true);
  };

  const closeAccessModal = () => {
    setAccessModalOpen(false);
    setAccessEditingApiKeyId(null);
    setAccessAllowedIndexesValue('');
    setAccessAllowedIdsValue('');
    setSelectedAuthIndex('');
  };

  const updateApiKeys = (nextKeys: string[]) => {
    onChange(nextKeys.join('\n'));
  };

  const handleDelete = (apiKeyId: string) => {
    const index = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    if (index < 0) return;
    const removedKey = apiKeys[index] ?? '';
    setApiKeyIds(renderApiKeyIds.filter((id) => id !== apiKeyId));
    const nextKeys = apiKeys.filter((_, i) => i !== index);
    updateApiKeys(nextKeys);
    onAccessRulesChange(
      normalizeAccessRulesForKeys(
        nextKeys,
        accessRules.filter((rule) => rule.apiKey.trim() !== removedKey.trim())
      )
    );
  };

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    const trimmedAlias = inputAliasValue.trim();
    if (!trimmed) {
      setFormError(t('config_management.visual.api_keys.error_empty'));
      return;
    }
    if (!isValidApiKeyCharset(trimmed)) {
      setFormError(t('config_management.visual.api_keys.error_invalid'));
      return;
    }
    const editingIndex = editingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId)
      : -1;
    const previousKey = editingIndex >= 0 ? (apiKeys[editingIndex] ?? '') : '';
    const nextKeys =
      editingApiKeyId === null
        ? [...apiKeys, trimmed]
        : apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key));
    const activeApiKeyHashes = collectActiveApiKeyHashes(nextKeys);

    if (trimmedAlias) {
      const aliasError = validateAlias(trimmedAlias, getApiKeyHash(trimmed), activeApiKeyHashes);
      if (aliasError) {
        setFormError(aliasError);
        return;
      }
      if (!aliasesAvailable) {
        setFormError(t('config_management.visual.api_keys.alias_unavailable'));
        return;
      }
    }

    if (trimmedAlias) {
      const cleanupDecision = await requestOrphanAliasCleanup(
        trimmedAlias,
        getApiKeyHash(trimmed),
        activeApiKeyHashes
      );
      if (!cleanupDecision.shouldContinue) {
        setFormError(t('config_management.visual.api_keys.alias_cleanup_cancelled'));
        return;
      }
      try {
        setAliasSaving(true);
        await saveAliasForKey(
          trimmed,
          trimmedAlias,
          activeApiKeyHashes,
          cleanupDecision.allowOrphanAliasCleanup
        );
        showNotification(t('config_management.visual.api_keys.alias_saved'), 'success');
      } catch (error) {
        setFormError(getAliasErrorMessage(error));
        setAliasSaving(false);
        return;
      }
      setAliasSaving(false);
    }

    if (editingApiKeyId === null) {
      setApiKeyIds([...renderApiKeyIds, makeClientId()]);
    }
    updateApiKeys(nextKeys);
    const renamedRules = accessRules.map((rule) =>
      previousKey && rule.apiKey.trim() === previousKey.trim() ? { ...rule, apiKey: trimmed } : rule
    );
    const existingRule = getAccessRuleForApiKey(previousKey || trimmed);
    const nextRule: ApiKeyAccessRule = {
      ...existingRule,
      apiKey: trimmed,
      allowedAuthIndexesText: accessAllowedIndexesValue,
      allowedAuthIdsText: accessAllowedIdsValue,
    };
    const nextRules = renamedRules.some((rule) => rule.apiKey.trim() === trimmed)
      ? renamedRules.map((rule) => (rule.apiKey.trim() === trimmed ? nextRule : rule))
      : [...renamedRules, nextRule];
    onAccessRulesChange(normalizeAccessRulesForKeys(nextKeys, nextRules));
    closeModal();
  };

  const handleAccessSave = () => {
    const editingIndex = accessEditingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === accessEditingApiKeyId)
      : -1;
    const editingKey = apiKeys[editingIndex] ?? '';
    if (!editingKey.trim()) return;

    const currentRule = getAccessRuleForApiKey(editingKey);
    const nextRule: ApiKeyAccessRule = {
      ...currentRule,
      apiKey: editingKey.trim(),
      allowedAuthIndexesText: accessAllowedIndexesValue,
      allowedAuthIdsText: accessAllowedIdsValue,
    };
    const nextRules = accessRules.some((rule) => rule.apiKey.trim() === editingKey.trim())
      ? accessRules.map((rule) => (rule.apiKey.trim() === editingKey.trim() ? nextRule : rule))
      : [...accessRules, nextRule];
    onAccessRulesChange(normalizeAccessRulesForKeys(apiKeys, nextRules));
    closeAccessModal();
  };

  const handleAddSelectedAuthIndex = () => {
    const authIndex = selectedAuthIndex.trim();
    if (!authIndex) return;
    const existing = splitAccessRuleListText(accessAllowedIndexesValue);
    if (existing.includes(authIndex)) {
      return;
    }
    setAccessAllowedIndexesValue([...existing, authIndex].join('\n'));
    setSelectedAuthIndex('');
  };

  const handleAddUnusedAuthIndexes = () => {
    if (unusedAuthIndexOptions.length === 0) return;
    const existing = splitAccessRuleListText(accessAllowedIndexesValue);
    const existingSet = new Set(existing);
    const next = [...existing];
    unusedAuthIndexOptions.forEach((option) => {
      if (existingSet.has(option.value)) return;
      existingSet.add(option.value);
      next.push(option.value);
    });
    setAccessAllowedIndexesValue(next.join('\n'));
    setSelectedAuthIndex('');
  };

  const handleAddAllAuthIndexes = () => {
    if (unselectedAuthIndexOptions.length === 0) return;
    const existing = splitAccessRuleListText(accessAllowedIndexesValue);
    const existingSet = new Set(existing);
    const next = [...existing];
    unselectedAuthIndexOptions.forEach((option) => {
      if (existingSet.has(option.value)) return;
      existingSet.add(option.value);
      next.push(option.value);
    });
    setAccessAllowedIndexesValue(next.join('\n'));
    setSelectedAuthIndex('');
  };

  const handleRemoveAllowedAuthIndex = (authIndex: string) => {
    const next = allowedAuthIndexes.filter((item) => item !== authIndex);
    setAccessAllowedIndexesValue(next.join('\n'));
  };

  const handleRemoveAllowedAuthId = (authId: string) => {
    const next = allowedAuthIds.filter((item) => item !== authId);
    setAccessAllowedIdsValue(next.join('\n'));
  };

  const renderAllowedAuthIndexList = () => (
    <div className={styles.allowedCredentialList}>
      {allowedAuthIndexes.length === 0 ? (
        <div className={styles.allowedCredentialEmpty}>
          {t('config_management.visual.api_key_access_rules.status_denied')}
        </div>
      ) : (
        allowedAuthIndexes.map((authIndex) => {
          const option = authIndexOptionByValue.get(authIndex);
          return (
            <div
              key={authIndex}
              className={styles.allowedCredentialItem}
              title={option?.label ?? `#${authIndex}`}
            >
              <div className={styles.allowedCredentialMain}>
                <div className={styles.allowedCredentialTitle}>
                  {option?.label ?? `#${authIndex}`}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleRemoveAllowedAuthIndex(authIndex)}
                disabled={disabled}
              >
                {t('config_management.visual.common.delete')}
              </Button>
            </div>
          );
        })
      )}
    </div>
  );

  const renderAllowedAuthIdList = () =>
    allowedAuthIds.length === 0 ? null : (
      <div className={styles.allowedCredentialList}>
        {allowedAuthIds.map((authId) => (
          <div key={authId} className={styles.allowedCredentialItem} title={`auth ID: ${authId}`}>
            <div className={styles.allowedCredentialMain}>
              <div className={styles.allowedCredentialTitle}>{authId}</div>
              <div className={styles.allowedCredentialMeta}>auth ID</div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleRemoveAllowedAuthId(authId)}
              disabled={disabled}
            >
              {t('config_management.visual.common.delete')}
            </Button>
          </div>
        ))}
      </div>
    );

  const renderAuthIndexPicker = () => (
    <div className="form-group">
      <label className={styles.blockLabel}>
        {t('config_management.visual.api_keys.auth_index_select')}
      </label>
      <div className={styles.authIndexPickerRow}>
        <Select
          className={styles.authIndexSelect}
          dropdownClassName={styles.authIndexSelectDropdown}
          dropdownWidth={320}
          fullWidth={false}
          searchable
          searchPlaceholder={t('config_management.visual.api_keys.auth_index_search_placeholder')}
          emptyText={t('config_management.visual.api_keys.auth_index_search_empty')}
          value={selectedAuthIndex}
          options={authIndexOptions}
          onChange={setSelectedAuthIndex}
          placeholder={
            authIndexOptionsLoading
              ? t('common.loading')
              : t('config_management.visual.api_keys.auth_index_select_placeholder')
          }
          disabled={disabled || authIndexOptions.length === 0}
          ariaLabel={t('config_management.visual.api_keys.auth_index_select')}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleAddSelectedAuthIndex}
          disabled={disabled || !selectedAuthIndex}
        >
          {t('config_management.visual.api_keys.auth_index_add')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={styles.authIndexBulkButton}
          onClick={handleAddUnusedAuthIndexes}
          disabled={disabled || unusedAuthIndexOptions.length === 0}
        >
          {t('config_management.visual.api_keys.auth_index_add_unused')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={styles.authIndexBulkButton}
          onClick={handleAddAllAuthIndexes}
          disabled={disabled || unselectedAuthIndexOptions.length === 0}
        >
          {t('config_management.visual.api_keys.auth_index_add_all')}
        </Button>
      </div>
      {authIndexOptions.length === 0 && !authIndexOptionsLoading ? (
        <div className="hint">{t('config_management.visual.api_keys.auth_index_empty')}</div>
      ) : null}
    </div>
  );

  const renderAccessRuleFields = () => (
    <>
      {renderAuthIndexPicker()}
      <div className="form-group">
        <label className={styles.blockLabel}>
          {t('config_management.visual.api_key_access_rules.allowed_indexes')}
        </label>
        {renderAllowedAuthIndexList()}
        <div className="hint">{t('config_management.visual.api_keys.access_hint')}</div>
      </div>
      {allowedAuthIds.length > 0 ? (
        <div className="form-group">
          <label className={styles.blockLabel}>
            {t('config_management.visual.api_key_access_rules.allowed_ids')}
          </label>
          {renderAllowedAuthIdList()}
          <div className="hint">{t('config_management.visual.api_keys.auth_id_hint')}</div>
        </div>
      ) : null}
    </>
  );

  const handleAliasSave = async () => {
    const editingIndex = aliasEditingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === aliasEditingApiKeyId)
      : -1;
    const editingKey = apiKeys[editingIndex] ?? '';
    const activeApiKeyHashes = collectActiveApiKeyHashes(apiKeys);
    const aliasError = validateAlias(
      aliasInputValue,
      getApiKeyHash(editingKey),
      activeApiKeyHashes
    );
    if (aliasError) {
      setAliasFormError(aliasError);
      return;
    }

    const cleanupDecision = await requestOrphanAliasCleanup(
      aliasInputValue,
      getApiKeyHash(editingKey),
      activeApiKeyHashes
    );
    if (!cleanupDecision.shouldContinue) {
      setAliasFormError(t('config_management.visual.api_keys.alias_cleanup_cancelled'));
      return;
    }

    setAliasSaving(true);
    try {
      await saveAliasForKey(
        editingKey,
        aliasInputValue,
        activeApiKeyHashes,
        cleanupDecision.allowOrphanAliasCleanup
      );
      showNotification(t('config_management.visual.api_keys.alias_saved'), 'success');
      closeAliasModal();
    } catch (error) {
      setAliasFormError(getAliasErrorMessage(error));
    } finally {
      setAliasSaving(false);
    }
  };

  const handleAliasDelete = () => {
    const editingIndex = aliasEditingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === aliasEditingApiKeyId)
      : -1;
    const editingKey = apiKeys[editingIndex] ?? '';
    const apiKeyHash = getApiKeyHash(editingKey);
    if (!apiKeyHash || !aliasByHash.has(apiKeyHash)) return;

    showConfirmation({
      title: t('config_management.visual.api_keys.alias_delete_title'),
      message: t('config_management.visual.api_keys.alias_delete_confirm'),
      confirmText: t('config_management.visual.api_keys.alias_delete'),
      variant: 'danger',
      onConfirm: async () => {
        setAliasSaving(true);
        try {
          await deleteAliasForHash(apiKeyHash);
          showNotification(t('config_management.visual.api_keys.alias_deleted'), 'success');
          closeAliasModal();
        } catch (error) {
          setAliasFormError(getAliasErrorMessage(error));
        } finally {
          setAliasSaving(false);
        }
      },
    });
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const handleGenerate = () => {
    setInputValue(generateSecureApiKey());
    setFormError('');
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <div className={styles.blockHeaderRow}>
        <label style={{ margin: 0 }}>{t('config_management.visual.api_keys.label')}</label>
        <Button size="sm" onClick={openAddModal} disabled={disabled}>
          {t('config_management.visual.api_keys.add')}
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <div className={styles.emptyState}>{t('config_management.visual.api_keys.empty')}</div>
      ) : (
        <div className="item-list" style={{ marginTop: 4 }}>
          {apiKeys.map((key, index) => {
            const apiKeyHash = getApiKeyHash(key);
            const alias = apiKeyHash ? (aliasByHash.get(apiKeyHash)?.alias ?? '') : '';
            const accessRule = getAccessRuleForApiKey(key);
            const allowedCount = getAllowedCount(accessRule);
            return (
              <div key={renderApiKeyIds[index] ?? `${key}-${index}`} className="item-row">
                <div className="item-meta">
                  <div className="item-title">
                    {alias || t('config_management.visual.api_keys.input_label')}
                  </div>
                  <div className="item-subtitle">{maskApiKey(String(key || ''))}</div>
                  <div className={styles.accessRuleStatus}>
                    {allowedCount > 0
                      ? t('config_management.visual.api_key_access_rules.status_allowed', {
                          count: allowedCount,
                        })
                      : t('config_management.visual.api_key_access_rules.status_denied')}
                  </div>
                </div>
                <div className="item-actions">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => openAccessModal(renderApiKeyIds[index] ?? '')}
                    disabled={disabled}
                  >
                    {t('config_management.visual.api_keys.access_action')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => openAliasModal(renderApiKeyIds[index] ?? '')}
                    disabled={disabled || aliasesLoading || !aliasesAvailable}
                  >
                    {t('config_management.visual.api_keys.alias_action')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => handleCopy(key)}
                    disabled={disabled}
                  >
                    {t('common.copy')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => openEditModal(renderApiKeyIds[index] ?? '')}
                    disabled={disabled}
                  >
                    {t('config_management.visual.common.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="xs"
                    onClick={() => handleDelete(renderApiKeyIds[index] ?? '')}
                    disabled={disabled}
                  >
                    {t('config_management.visual.common.delete')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="hint">{t('config_management.visual.api_keys.hint')}</div>
      {!aliasesAvailable && !aliasesLoading ? (
        <div className="hint">{t('config_management.visual.api_keys.alias_unavailable')}</div>
      ) : null}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          editingApiKeyId !== null
            ? t('config_management.visual.api_keys.edit_title')
            : t('config_management.visual.api_keys.add_title')
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={disabled || aliasSaving}>
              {t('config_management.visual.common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={disabled || aliasSaving}>
              {editingApiKeyId !== null
                ? t('config_management.visual.common.update')
                : t('config_management.visual.common.add')}
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label htmlFor={apiKeyInputId}>
            {t('config_management.visual.api_keys.input_label')}
          </label>
          <div className={styles.apiKeyModalInputRow}>
            <input
              id={apiKeyInputId}
              className="input"
              placeholder={t('config_management.visual.api_keys.input_placeholder')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={disabled}
              aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
              aria-invalid={Boolean(formError)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={disabled}
            >
              {t('config_management.visual.api_keys.generate')}
            </Button>
          </div>
          <div id={apiKeyHintId} className="hint">
            {t('config_management.visual.api_keys.input_hint')}
          </div>
          <div className="form-group">
            <label htmlFor={keyAliasInputId}>
              {t('config_management.visual.api_keys.alias_label')}
            </label>
            <input
              id={keyAliasInputId}
              className="input"
              placeholder={t('config_management.visual.api_keys.alias_placeholder')}
              value={inputAliasValue}
              onChange={(e) => setInputAliasValue(e.target.value)}
              disabled={disabled || aliasesLoading || !aliasesAvailable}
              maxLength={120}
            />
            <div className="hint">{t('config_management.visual.api_keys.alias_hint')}</div>
          </div>
          {renderAccessRuleFields()}
          {formError && (
            <div id={apiKeyErrorId} className="error-box">
              {formError}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={accessModalOpen}
        onClose={closeAccessModal}
        title={t('config_management.visual.api_keys.access_title')}
        footer={
          <>
            <Button variant="secondary" onClick={closeAccessModal} disabled={disabled}>
              {t('config_management.visual.common.cancel')}
            </Button>
            <Button onClick={handleAccessSave} disabled={disabled}>
              {t('config_management.visual.common.update')}
            </Button>
          </>
        }
      >
        {renderAccessRuleFields()}
      </Modal>

      <Modal
        open={aliasModalOpen}
        onClose={closeAliasModal}
        title={t('config_management.visual.api_keys.alias_title')}
        footer={
          <>
            {aliasEditingApiKeyId &&
            aliasByHash.has(
              getApiKeyHash(
                apiKeys[renderApiKeyIds.findIndex((id) => id === aliasEditingApiKeyId)] ?? ''
              )
            ) ? (
              <Button
                variant="danger"
                onClick={handleAliasDelete}
                disabled={disabled || aliasSaving}
              >
                {t('config_management.visual.api_keys.alias_delete')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={closeAliasModal}
              disabled={disabled || aliasSaving}
            >
              {t('config_management.visual.common.cancel')}
            </Button>
            <Button onClick={handleAliasSave} disabled={disabled || aliasSaving}>
              {t('config_management.visual.common.update')}
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label htmlFor={aliasModalInputId}>
            {t('config_management.visual.api_keys.alias_label')}
          </label>
          <input
            id={aliasModalInputId}
            className="input"
            placeholder={t('config_management.visual.api_keys.alias_placeholder')}
            value={aliasInputValue}
            onChange={(e) => {
              setAliasInputValue(e.target.value);
              setAliasFormError('');
            }}
            disabled={disabled || aliasSaving}
            maxLength={120}
            aria-describedby={aliasFormError ? aliasModalErrorId : undefined}
            aria-invalid={Boolean(aliasFormError)}
          />
          <div className="hint">{t('config_management.visual.api_keys.alias_hint')}</div>
          {aliasFormError && (
            <div id={aliasModalErrorId} className="error-box">
              {aliasFormError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
});

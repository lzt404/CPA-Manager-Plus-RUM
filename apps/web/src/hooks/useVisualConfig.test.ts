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
  it('loads plugin system state from plugins.enabled', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['plugins:', '  enabled: true', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.pluginsEnabled).toBe(true);
    harness.unmount();
  });

  it('loads plugin directory and store sources from plugins config', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'plugins:',
      '  enabled: true',
      '  dir: /data/cpa/plugins',
      '  store-sources:',
      '    - https://plugins.example.com/official.json',
      '    - https://plugins.example.com/private.json',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    expect(harness.getCurrent().visualValues.pluginsEnabled).toBe(true);
    expect(harness.getCurrent().visualValues.pluginsDir).toBe('/data/cpa/plugins');
    expect(harness.getCurrent().visualValues.pluginStoreSourcesText).toBe(
      [
        'https://plugins.example.com/official.json',
        'https://plugins.example.com/private.json',
      ].join('\n')
    );

    harness.unmount();
  });

  it('writes plugins.enabled when enabling plugin system from visual editor', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['host: 127.0.0.1', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    act(() => {
      harness.getCurrent().setVisualValues({ pluginsEnabled: true });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    expect(savedYaml).toContain('plugins:');
    expect(savedYaml).toContain('enabled: true');

    harness.unmount();
  });

  it('writes plugin directory and store sources while preserving plugin configs', () => {
    const harness = mountUseVisualConfig();
    const yaml = ['plugins:', '  configs:', '    demo:', '      enabled: true', ''].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    act(() => {
      harness.getCurrent().setVisualValues({
        pluginsDir: '/opt/cpa/plugins',
        pluginStoreSourcesText: [
          'https://plugins.example.com/official.json',
          '',
          ' https://plugins.example.com/private.json ',
        ].join('\n'),
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    const parsed = parseYaml(savedYaml) as {
      plugins?: {
        dir?: string;
        'store-sources'?: string[];
        configs?: { demo?: { enabled?: boolean } };
      };
    };

    expect(parsed.plugins?.dir).toBe('/opt/cpa/plugins');
    expect(parsed.plugins?.['store-sources']).toEqual([
      'https://plugins.example.com/official.json',
      'https://plugins.example.com/private.json',
    ]);
    expect(parsed.plugins?.configs?.demo?.enabled).toBe(true);

    harness.unmount();
  });

  it('clears plugin directory and store sources without removing plugin configs', () => {
    const harness = mountUseVisualConfig();
    const yaml = [
      'plugins:',
      '  dir: /opt/cpa/plugins',
      '  store-sources:',
      '    - https://plugins.example.com/official.json',
      '  configs:',
      '    demo:',
      '      enabled: true',
      '',
    ].join('\n');

    act(() => {
      const result = harness.getCurrent().loadVisualValuesFromYaml(yaml);
      expect(result.ok).toBe(true);
    });

    act(() => {
      harness.getCurrent().setVisualValues({
        pluginsDir: '',
        pluginStoreSourcesText: '',
      });
    });

    const savedYaml = harness.getCurrent().applyVisualChangesToYaml(yaml);
    const parsed = parseYaml(savedYaml) as {
      plugins?: {
        dir?: string;
        'store-sources'?: string[];
        configs?: { demo?: { enabled?: boolean } };
      };
    };

    expect(parsed.plugins?.dir).toBeUndefined();
    expect(parsed.plugins?.['store-sources']).toBeUndefined();
    expect(parsed.plugins?.configs?.demo?.enabled).toBe(true);

    harness.unmount();
  });

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

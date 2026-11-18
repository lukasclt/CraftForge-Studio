import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench } from 'lucide-react';
import type { GradleDsl, JavaVersion, ProjectConfig, ProjectPlatform, VirtualFile } from '../types/ide';
import {
  DEPENDENCY_PRESETS,
  JAVA_VERSIONS,
  MINECRAFT_VERSIONS,
  PLATFORM_LABELS,
  getRecommendedGradleForJava,
  getRecommendedJavaForMinecraft,
  validateGradleSetup,
} from '../utils/gradleEngine';

interface GradleConfigSidebarProps {
  config: ProjectConfig;
  files: Record<string, VirtualFile>;
  onApplyConfig: (nextConfig: ProjectConfig, regenerateAll: boolean) => void;
}

export const GradleConfigSidebar: React.FC<GradleConfigSidebarProps> = ({
  config,
  files,
  onApplyConfig,
}) => {
  const [draft, setDraft] = useState<ProjectConfig>(config);
  const [customMc, setCustomMc] = useState('');

  React.useEffect(() => {
    setDraft(config);
  }, [config]);

  const validation = validateGradleSetup(draft, files);

  const handleMcChange = (version: string) => {
    const recJava = getRecommendedJavaForMinecraft(version);
    const recGradle = getRecommendedGradleForJava(recJava, draft.platform, version);
    setDraft((prev) => ({
      ...prev,
      minecraftVersion: version,
      javaVersion: recJava,
      gradleVersion: recGradle,
    }));
  };

  const handleJavaChange = (javaVersion: JavaVersion) => {
    const recGradle = getRecommendedGradleForJava(javaVersion, draft.platform, draft.minecraftVersion);
    setDraft((prev) => ({
      ...prev,
      javaVersion,
      gradleVersion: recGradle,
    }));
  };

  const toggleDependency = (coordinate: string) => {
    setDraft((prev) => {
      const exists = prev.dependencies.includes(coordinate);
      return {
        ...prev,
        dependencies: exists
          ? prev.dependencies.filter((d) => d !== coordinate)
          : [...prev.dependencies, coordinate],
      };
    });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 space-y-4">
      <div>
        <h2 className="text-xs font-semibold text-slate-200 mb-1">Matriz Gradle &amp; Toolchains</h2>
        <p className="text-[11px] text-slate-400">
          Configuração exclusiva via Gradle para qualquer versão de Minecraft e Java.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="gradle-platform" className="block text-[11px] font-medium text-slate-300 mb-1">
            Tipo / Plataforma
          </label>
          <select
            id="gradle-platform"
            value={draft.platform}
            onChange={(e) => {
              const platform = e.target.value as ProjectPlatform;
              setDraft((prev) => ({
                ...prev,
                platform,
                gradleVersion: getRecommendedGradleForJava(
                  prev.javaVersion,
                  platform,
                  prev.minecraftVersion
                ),
              }));
            }}
            className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="gradle-mc-version" className="block text-[11px] font-medium text-slate-300 mb-1">
            Versão do Minecraft
          </label>
          <select
            id="gradle-mc-version"
            value={MINECRAFT_VERSIONS.includes(draft.minecraftVersion) ? draft.minecraftVersion : '__custom'}
            onChange={(e) => {
              if (e.target.value !== '__custom') {
                handleMcChange(e.target.value);
              }
            }}
            className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            {MINECRAFT_VERSIONS.map((v) => (
              <option key={v} value={v}>
                Minecraft {v}
              </option>
            ))}
            <option value="__custom">Versão personalizada ({draft.minecraftVersion})</option>
          </select>

          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              type="text"
              value={customMc}
              onChange={(e) => setCustomMc(e.target.value)}
              placeholder="Ou digite qualquer versão (ex: 1.8.8, 1.19.2)"
              aria-label="Versão personalizada do Minecraft"
              className="flex-1 bg-[#0B0F17] border border-slate-800 rounded px-2 py-1 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (customMc.trim()) {
                  handleMcChange(customMc.trim());
                  setCustomMc('');
                }
              }}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] rounded cursor-pointer"
            >
              Usar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="gradle-java-version" className="block text-[11px] font-medium text-slate-300 mb-1">
              Java Toolchain
            </label>
            <select
              id="gradle-java-version"
              value={draft.javaVersion}
              onChange={(e) => handleJavaChange(Number(e.target.value) as JavaVersion)}
              className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {JAVA_VERSIONS.map((jv) => (
                <option key={jv} value={jv}>
                  Java {jv}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="gradle-dsl" className="block text-[11px] font-medium text-slate-300 mb-1">
              Gradle DSL
            </label>
            <select
              id="gradle-dsl"
              value={draft.dsl}
              onChange={(e) => setDraft((prev) => ({ ...prev, dsl: e.target.value as GradleDsl }))}
              className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="groovy">Groovy (.gradle)</option>
              <option value="kotlin">Kotlin (.gradle.kts)</option>
            </select>
          </div>
        </div>

        <div>
          <span className="block text-[11px] font-medium text-slate-300 mb-1.5">
            Dependências Gradle
          </span>
          <div className="space-y-1">
            {DEPENDENCY_PRESETS.filter((p) => p.platforms.includes(draft.platform)).map((preset) => {
              const checked = draft.dependencies.includes(preset.coordinate);
              return (
                <label
                  key={preset.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#0B0F17] border border-slate-800 hover:border-slate-700 cursor-pointer text-xs text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDependency(preset.coordinate)}
                    className="accent-emerald-500 rounded"
                  />
                  <span className="truncate">{preset.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 pt-2 border-t border-slate-800">
        {validation.diagnostics.map((d) => (
          <div
            key={d.code}
            className={`p-2.5 rounded-md border text-[11px] flex items-start gap-2 ${
              d.level === 'error'
                ? 'bg-red-950/40 border-red-800/60 text-red-200'
                : d.level === 'warning'
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  : 'bg-emerald-950/30 border-emerald-800/50 text-emerald-200'
            }`}
          >
            {d.level === 'ok' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle
                className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                  d.level === 'error' ? 'text-red-400' : 'text-amber-400'
                }`}
              />
            )}
            <div>
              <div>{d.message}</div>
              {d.suggestion && <div className="text-slate-400 mt-0.5">{d.suggestion}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 pt-1">
        <button
          type="button"
          onClick={() => onApplyConfig(draft, false)}
          className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>Atualizar build.gradle</span>
        </button>
        <button
          type="button"
          onClick={() => onApplyConfig(draft, true)}
          className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Regenerar Template Completo</span>
        </button>
      </div>
    </div>
  );
};

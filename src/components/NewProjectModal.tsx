import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { GradleDsl, JavaVersion, ProjectConfig, ProjectPlatform } from '../types/ide';
import {
  JAVA_VERSIONS,
  MINECRAFT_VERSIONS,
  PLATFORM_LABELS,
  getRecommendedGradleForJava,
  getRecommendedJavaForMinecraft,
  sanitizeIdentifier,
  toPascalCase,
} from '../utils/gradleEngine';

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (config: ProjectConfig) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ open, onClose, onCreate }) => {
  const [name, setName] = useState('MeuProjetoMinecraft');
  const [platform, setPlatform] = useState<ProjectPlatform>('pvp-client');
  const [minecraftVersion, setMinecraftVersion] = useState('1.8.9');
  const [javaVersion, setJavaVersion] = useState<JavaVersion>(8);
  const [dsl, setDsl] = useState<GradleDsl>('groovy');
  const [groupId, setGroupId] = useState('com.craftforge.projeto');

  if (!open) return null;

  const handleMcSelect = (v: string) => {
    setMinecraftVersion(v);
    setJavaVersion(getRecommendedJavaForMinecraft(v));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim() || 'MeuProjetoMinecraft';
    const artifactId = sanitizeIdentifier(cleanName, 'meuprojeto');
    const gradleVersion = getRecommendedGradleForJava(javaVersion, platform, minecraftVersion);
    onCreate({
      name: cleanName,
      platform,
      minecraftVersion: minecraftVersion.trim() || '1.21.4',
      javaVersion,
      gradleVersion,
      dsl,
      groupId: groupId.trim() || `com.craftforge.${artifactId}`,
      artifactId,
      version: '1.0.0',
      mainClass: toPascalCase(cleanName, 'MainProject'),
      description: `Projeto ${PLATFORM_LABELS[platform]} via Gradle`,
      dependencies: [],
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
    >
      <div className="bg-[#111827] border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="new-project-title" className="text-base font-semibold text-white">
            Novo Projeto Gradle Minecraft
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="p-1 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="np-name" className="block text-xs font-medium text-slate-300 mb-1">
              Nome do Projeto
            </label>
            <input
              id="np-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="np-platform" className="block text-xs font-medium text-slate-300 mb-1">
              Tipo (Plugin / Mod / Client de PvP)
            </label>
            <select
              id="np-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as ProjectPlatform)}
              className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {Object.entries(PLATFORM_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="np-mc" className="block text-xs font-medium text-slate-300 mb-1">
                Versão do Minecraft
              </label>
              <select
                id="np-mc"
                value={MINECRAFT_VERSIONS.includes(minecraftVersion) ? minecraftVersion : '1.21.4'}
                onChange={(e) => handleMcSelect(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {MINECRAFT_VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="np-java" className="block text-xs font-medium text-slate-300 mb-1">
                Versão do Java
              </label>
              <select
                id="np-java"
                value={javaVersion}
                onChange={(e) => setJavaVersion(Number(e.target.value) as JavaVersion)}
                className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {JAVA_VERSIONS.map((jv) => (
                  <option key={jv} value={jv}>
                    Java {jv}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="np-group" className="block text-xs font-medium text-slate-300 mb-1">
                Group ID (Pacote Java)
              </label>
              <input
                id="np-group"
                type="text"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="np-dsl" className="block text-xs font-medium text-slate-300 mb-1">
                Gradle DSL
              </label>
              <select
                id="np-dsl"
                value={dsl}
                onChange={(e) => setDsl(e.target.value as GradleDsl)}
                className="w-full bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="groovy">Groovy (build.gradle)</option>
                <option value="kotlin">Kotlin (build.gradle.kts)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-md cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md cursor-pointer"
            >
              Criar Projeto Gradle
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

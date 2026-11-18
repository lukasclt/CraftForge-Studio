import type {
  GradleDiagnostic,
  GradleValidationResult,
  JavaVersion,
  ProjectConfig,
  ProjectPlatform,
  VirtualFile,
} from '../types/ide';

export const MINECRAFT_VERSIONS: readonly string[] = [
  '1.21.5',
  '1.21.4',
  '1.21.3',
  '1.21.1',
  '1.20.6',
  '1.20.4',
  '1.20.1',
  '1.19.4',
  '1.18.2',
  '1.17.1',
  '1.16.5',
  '1.15.2',
  '1.14.4',
  '1.13.2',
  '1.12.2',
  '1.11.2',
  '1.10.2',
  '1.9.4',
  '1.8.9',
  '1.7.10',
];

export const JAVA_VERSIONS: readonly JavaVersion[] = [8, 11, 16, 17, 21, 22, 23, 24];

export const PLATFORM_LABELS: Record<ProjectPlatform, string> = {
  paper: 'Plugin Paper / Purpur / Folia',
  spigot: 'Plugin Spigot / Bukkit',
  velocity: 'Proxy Velocity',
  fabric: 'Mod Fabric',
  forge: 'Mod Forge',
  neoforge: 'Mod NeoForge',
  'pvp-client': 'Client de PvP (Mixin + Gradle)',
};

export interface DependencyPreset {
  id: string;
  label: string;
  coordinate: string;
  repository?: string;
  platforms: ProjectPlatform[];
}

export const DEPENDENCY_PRESETS: DependencyPreset[] = [
  {
    id: 'luckperms',
    label: 'LuckPerms API',
    coordinate: 'net.luckperms:api:5.4',
    platforms: ['paper', 'spigot', 'velocity'],
  },
  {
    id: 'placeholderapi',
    label: 'PlaceholderAPI',
    coordinate: 'me.clip:placeholderapi:2.11.6',
    repository: 'https://repo.extendedclip.com/content/repositories/placeholderapi/',
    platforms: ['paper', 'spigot'],
  },
  {
    id: 'vault',
    label: 'VaultAPI',
    coordinate: 'com.github.MilkBowl:VaultAPI:1.7.1',
    repository: 'https://jitpack.io',
    platforms: ['paper', 'spigot'],
  },
  {
    id: 'adventure',
    label: 'Kyori Adventure MiniMessage',
    coordinate: 'net.kyori:adventure-text-minimessage:4.17.0',
    platforms: ['paper', 'spigot', 'velocity', 'fabric'],
  },
  {
    id: 'lombok',
    label: 'Project Lombok',
    coordinate: 'org.projectlombok:lombok:1.18.36',
    platforms: ['paper', 'spigot', 'velocity', 'fabric', 'forge', 'neoforge', 'pvp-client'],
  },
  {
    id: 'mixin',
    label: 'SpongePowered Mixin',
    coordinate: 'org.spongepowered:mixin:0.8.7',
    repository: 'https://repo.spongepowered.org/repository/maven-public/',
    platforms: ['pvp-client', 'forge', 'fabric'],
  },
  {
    id: 'gson',
    label: 'Google Gson (Configs JSON)',
    coordinate: 'com.google.code.gson:gson:2.11.0',
    platforms: ['paper', 'spigot', 'velocity', 'fabric', 'forge', 'neoforge', 'pvp-client'],
  },
];

export function parseMinecraftMinor(mcVersion: string): { major: number; minor: number; patch: number } {
  const cleaned = mcVersion.trim().replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.').map((p) => Number.parseInt(p, 10));
  return {
    major: Number.isFinite(parts[0]) ? parts[0] : 1,
    minor: Number.isFinite(parts[1]) ? parts[1] : 21,
    patch: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
}

export function getRecommendedJavaForMinecraft(mcVersion: string): JavaVersion {
  const { minor, patch } = parseMinecraftMinor(mcVersion);
  if (minor <= 16) return 8;
  if (minor === 17) return 16;
  if (minor >= 18 && (minor < 20 || (minor === 20 && patch <= 4))) return 17;
  return 21;
}

export function getRecommendedGradleForJava(javaVersion: JavaVersion, platform: ProjectPlatform, mcVersion: string): string {
  const { minor } = parseMinecraftMinor(mcVersion);
  if (platform === 'forge' && minor <= 12 && javaVersion === 8) {
    return '4.10.3';
  }
  if (javaVersion >= 23) return '8.12';
  if (javaVersion >= 21) return '8.11.1';
  if (javaVersion >= 17) return '8.8';
  if (javaVersion >= 11) return '7.6.4';
  return '7.6.4';
}

export function validateGradleSetup(
  config: ProjectConfig,
  files: Record<string, VirtualFile>
): GradleValidationResult {
  const recommendedJava = getRecommendedJavaForMinecraft(config.minecraftVersion);
  const recommendedGradle = getRecommendedGradleForJava(
    config.javaVersion,
    config.platform,
    config.minecraftVersion
  );
  const diagnostics: GradleDiagnostic[] = [];
  const { minor, patch } = parseMinecraftMinor(config.minecraftVersion);

  const hasBuildFile = Boolean(files['build.gradle'] || files['build.gradle.kts']);
  const hasSettingsFile = Boolean(files['settings.gradle'] || files['settings.gradle.kts']);
  const hasWrapperProps = Boolean(files['gradle/wrapper/gradle-wrapper.properties']);

  if (!hasBuildFile) {
    diagnostics.push({
      level: 'error',
      code: 'GRADLE_BUILD_MISSING',
      message: 'Arquivo build.gradle ou build.gradle.kts ausente na raiz.',
      suggestion: 'Gere ou crie build.gradle para compilar exclusivamente com Gradle.',
    });
  }

  if (!hasSettingsFile) {
    diagnostics.push({
      level: 'warning',
      code: 'GRADLE_SETTINGS_MISSING',
      message: 'settings.gradle ausente. Recomendado definir rootProject.name.',
    });
  }

  if (!hasWrapperProps) {
    diagnostics.push({
      level: 'warning',
      code: 'GRADLE_WRAPPER_MISSING',
      message: 'gradle/wrapper/gradle-wrapper.properties não encontrado.',
      suggestion: `Adicione o wrapper Gradle ${recommendedGradle} para builds reproduzíveis.`,
    });
  }

  if ((minor > 20 || (minor === 20 && patch >= 5)) && config.javaVersion < 21) {
    diagnostics.push({
      level: 'error',
      code: 'JAVA_TOO_OLD_FOR_MC',
      message: `Minecraft ${config.minecraftVersion} exige Java 21 ou superior (atual: Java ${config.javaVersion}).`,
      suggestion: `Altere a Java Toolchain no Gradle para Java ${recommendedJava}.`,
    });
  } else if (minor >= 18 && minor <= 20 && patch <= 4 && config.javaVersion < 17) {
    diagnostics.push({
      level: 'error',
      code: 'JAVA_TOO_OLD_FOR_MC_118',
      message: `Minecraft ${config.minecraftVersion} exige pelo menos Java 17 (atual: Java ${config.javaVersion}).`,
      suggestion: 'Configure JavaLanguageVersion.of(17) no bloco java.toolchain.',
    });
  } else if (minor <= 12 && config.platform === 'forge' && config.javaVersion > 8) {
    diagnostics.push({
      level: 'warning',
      code: 'LEGACY_FORGE_JAVA_TOOLCHAIN',
      message: `Forge ${config.minecraftVersion} funciona nativamente com Java 8. Java ${config.javaVersion} pode exigir RetroFuturaGradle.`,
      suggestion: 'Use Java Toolchain 8 ou habilite RetroFuturaGradle para compilar legado.',
    });
  }

  if (config.platform === 'neoforge' && (minor < 20 || (minor === 20 && patch < 1))) {
    diagnostics.push({
      level: 'error',
      code: 'NEOFORGE_MIN_VERSION',
      message: `NeoForge suporta apenas Minecraft 1.20.1+ (selecionado: ${config.minecraftVersion}).`,
      suggestion: 'Para versões anteriores a 1.20.1, selecione Forge ou Fabric.',
    });
  }

  if (config.platform === 'fabric' && minor < 14) {
    diagnostics.push({
      level: 'warning',
      code: 'FABRIC_LEGACY_NOTE',
      message: `Fabric oficial começou no Minecraft 1.14. Para ${config.minecraftVersion}, considere Legacy Fabric (Loom) ou Forge.`,
    });
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      level: 'ok',
      code: 'GRADLE_MATRIX_VALID',
      message: `Matriz Gradle válida: ${PLATFORM_LABELS[config.platform]} · MC ${config.minecraftVersion} · Java ${config.javaVersion} · Gradle ${config.gradleVersion}.`,
    });
  }

  return {
    valid: !diagnostics.some((d) => d.level === 'error'),
    recommendedJava,
    recommendedGradle,
    diagnostics,
  };
}

export function sanitizeIdentifier(value: string, fallback = 'craftforge'): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return cleaned || fallback;
}

export function toPascalCase(value: string, fallback = 'CraftForgeMain'): string {
  const tokens = value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return fallback;
  return tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('');
}

function resolveArtifactDependenciesBlock(config: ProjectConfig, isKotlin: boolean): string {
  const deps = config.dependencies
    .map((coord) => {
      const preset = DEPENDENCY_PRESETS.find((p) => p.coordinate === coord || p.id === coord);
      const resolved = preset ? preset.coordinate : coord;
      if (resolved.includes('lombok')) {
        return isKotlin
          ? `    compileOnly("${resolved}")\n    annotationProcessor("${resolved}")`
          : `    compileOnly '${resolved}'\n    annotationProcessor '${resolved}'`;
      }
      if (resolved.includes('mixin')) {
        return isKotlin
          ? `    implementation("${resolved}")`
          : `    implementation '${resolved}'`;
      }
      return isKotlin
        ? `    compileOnly("${resolved}")`
        : `    compileOnly '${resolved}'`;
    })
    .join('\n');
  return deps;
}

function generateBuildGradle(config: ProjectConfig): string {
  const isKotlin = config.dsl === 'kotlin';
  const { minor } = parseMinecraftMinor(config.minecraftVersion);
  const extraDeps = resolveArtifactDependenciesBlock(config, isKotlin);
  const q = isKotlin ? '"' : "'";

  const extraRepos = [
    `    mavenCentral()`,
    `    maven(${isKotlin ? 'url = uri("https://jitpack.io")' : "{ url 'https://jitpack.io' }"})`,
    `    maven(${isKotlin ? 'url = uri("https://repo.extendedclip.com/content/repositories/placeholderapi/")' : "{ url 'https://repo.extendedclip.com/content/repositories/placeholderapi/' }"})`,
  ];

  if (config.platform === 'paper' || config.platform === 'velocity') {
    extraRepos.unshift(
      `    maven(${isKotlin ? 'url = uri("https://repo.papermc.io/repository/maven-public/")' : "{ url 'https://repo.papermc.io/repository/maven-public/' }"})`
    );
  } else if (config.platform === 'spigot') {
    extraRepos.unshift(
      `    maven(${isKotlin ? 'url = uri("https://hub.spigotmc.org/nexus/content/repositories/snapshots/")' : "{ url 'https://hub.spigotmc.org/nexus/content/repositories/snapshots/' }"})`,
      `    maven(${isKotlin ? 'url = uri("https://oss.sonatype.org/content/repositories/snapshots")' : "{ url 'https://oss.sonatype.org/content/repositories/snapshots' }"})`
    );
  } else if (config.platform === 'fabric' || (config.platform === 'pvp-client' && minor >= 14)) {
    extraRepos.unshift(
      `    maven(${isKotlin ? 'url = uri("https://maven.fabricmc.net/")' : "{ url 'https://maven.fabricmc.net/' }"})`,
      `    maven(${isKotlin ? 'url = uri("https://repo.spongepowered.org/repository/maven-public/")' : "{ url 'https://repo.spongepowered.org/repository/maven-public/' }"})`
    );
  } else if (config.platform === 'forge' || (config.platform === 'pvp-client' && minor < 14)) {
    extraRepos.unshift(
      `    maven(${isKotlin ? 'url = uri("https://maven.minecraftforge.net/")' : "{ url 'https://maven.minecraftforge.net/' }"})`,
      `    maven(${isKotlin ? 'url = uri("https://repo.spongepowered.org/repository/maven-public/")' : "{ url 'https://repo.spongepowered.org/repository/maven-public/' }"})`
    );
  } else if (config.platform === 'neoforge') {
    extraRepos.unshift(
      `    maven(${isKotlin ? 'url = uri("https://maven.neoforged.net/releases")' : "{ url 'https://maven.neoforged.net/releases' }"})`
    );
  }

  let pluginsBlock = '';
  let platformDep = '';
  let extraBlock = '';

  if (config.platform === 'paper') {
    pluginsBlock = isKotlin
      ? `plugins {\n    java\n    id("com.gradleup.shadow") version "8.3.5"\n    id("xyz.jpenilla.run-paper") version "2.3.1"\n}`
      : `plugins {\n    id 'java'\n    id 'com.gradleup.shadow' version '8.3.5'\n    id 'xyz.jpenilla.run-paper' version '2.3.1'\n}`;
    const apiCoord =
      minor >= 17
        ? `io.papermc.paper:paper-api:${config.minecraftVersion}-R0.1-SNAPSHOT`
        : `com.destroystokyo.paper:paper-api:${config.minecraftVersion}-R0.1-SNAPSHOT`;
    platformDep = isKotlin ? `    compileOnly("${apiCoord}")` : `    compileOnly '${apiCoord}'`;
    extraBlock = isKotlin
      ? `\ntasks.runServer {\n    minecraftVersion("${config.minecraftVersion}")\n}`
      : `\ntasks {\n    runServer {\n        minecraftVersion('${config.minecraftVersion}')\n    }\n}`;
  } else if (config.platform === 'spigot') {
    pluginsBlock = isKotlin
      ? `plugins {\n    java\n    id("com.gradleup.shadow") version "8.3.5"\n}`
      : `plugins {\n    id 'java'\n    id 'com.gradleup.shadow' version '8.3.5'\n}`;
    platformDep = isKotlin
      ? `    compileOnly("org.spigotmc:spigot-api:${config.minecraftVersion}-R0.1-SNAPSHOT")`
      : `    compileOnly 'org.spigotmc:spigot-api:${config.minecraftVersion}-R0.1-SNAPSHOT'`;
  } else if (config.platform === 'velocity') {
    pluginsBlock = isKotlin
      ? `plugins {\n    java\n    id("com.gradleup.shadow") version "8.3.5"\n}`
      : `plugins {\n    id 'java'\n    id 'com.gradleup.shadow' version '8.3.5'\n}`;
    platformDep = isKotlin
      ? `    compileOnly("com.velocitypowered:velocity-api:3.4.0-SNAPSHOT")\n    annotationProcessor("com.velocitypowered:velocity-api:3.4.0-SNAPSHOT")`
      : `    compileOnly 'com.velocitypowered:velocity-api:3.4.0-SNAPSHOT'\n    annotationProcessor 'com.velocitypowered:velocity-api:3.4.0-SNAPSHOT'`;
  } else if (config.platform === 'fabric' || (config.platform === 'pvp-client' && minor >= 14)) {
    pluginsBlock = isKotlin
      ? `plugins {\n    id("fabric-loom") version "1.9-SNAPSHOT"\n    \`maven-publish\`\n}`
      : `plugins {\n    id 'fabric-loom' version '1.9-SNAPSHOT'\n    id 'maven-publish'\n}`;
    platformDep = isKotlin
      ? `    minecraft("com.mojang:minecraft:${config.minecraftVersion}")\n    mappings("net.fabricmc:yarn:${config.minecraftVersion}+build.1:v2")\n    modImplementation("net.fabricmc:fabric-loader:0.16.10")\n    modImplementation("net.fabricmc.fabric-api:fabric-api:0.115.0+${config.minecraftVersion}")`
      : `    minecraft "com.mojang:minecraft:${config.minecraftVersion}"\n    mappings "net.fabricmc:yarn:${config.minecraftVersion}+build.1:v2"\n    modImplementation "net.fabricmc:fabric-loader:0.16.10"\n    modImplementation "net.fabricmc.fabric-api:fabric-api:0.115.0+${config.minecraftVersion}"`;
  } else if (config.platform === 'neoforge') {
    pluginsBlock = isKotlin
      ? `plugins {\n    id("net.neoforged.moddev") version "2.0.78"\n}`
      : `plugins {\n    id 'net.neoforged.moddev' version '2.0.78'\n}`;
    extraBlock = isKotlin
      ? `\nneoForge {\n    version = "21.4.84-beta"\n    parchment {\n        minecraftVersion = "${config.minecraftVersion}"\n        mappingsVersion = "2024.11.17"\n    }\n}`
      : `\nneoForge {\n    version = '21.4.84-beta'\n    parchment {\n        minecraftVersion = '${config.minecraftVersion}'\n        mappingsVersion = '2024.11.17'\n    }\n}`;
  } else {
    // Forge or Legacy 1.8.9 PvP Client (Gradle + Mixin)
    const isLegacy189 = minor <= 12;
    pluginsBlock = isKotlin
      ? `plugins {\n    java\n    id("net.minecraftforge.gradle") version "${isLegacy189 ? '6.0.+' : '6.0.+'}"\n}`
      : `plugins {\n    id 'java'\n    id 'net.minecraftforge.gradle' version '6.0.+'\n}`;
    platformDep = isKotlin
      ? `    minecraft("net.minecraftforge:forge:${config.minecraftVersion}-${isLegacy189 ? '11.15.1.2318-1.8.9' : '47.3.0'}")\n    implementation("org.spongepowered:mixin:0.8.7")`
      : `    minecraft 'net.minecraftforge:forge:${config.minecraftVersion}-${isLegacy189 ? '11.15.1.2318-1.8.9' : '47.3.0'}'\n    implementation 'org.spongepowered:mixin:0.8.7'`;
    extraBlock = `\nminecraft {\n    mappings channel${isKotlin ? ' =' : ''} ${q}stable${q}, version${isKotlin ? ' =' : ''} ${q}${isLegacy189 ? '22-1.8.9' : '20230612-1.20.1'}${q}\n}`;
  }

  return `${pluginsBlock}

group = ${q}${config.groupId}${q}
version = ${q}${config.version}${q}

java {
    toolchain {
        languageVersion${isKotlin ? '.set(' : ' = '}JavaLanguageVersion.of(${config.javaVersion})${isKotlin ? ')' : ''}
    }
}

repositories {
${extraRepos.join('\n')}
}

dependencies {
${platformDep}${extraDeps ? `\n${extraDeps}` : ''}
}

tasks.withType${isKotlin ? '<JavaCompile>' : '(JavaCompile)'}${isKotlin ? '.configureEach' : ''} {
    options.encoding = ${q}UTF-8${q}
    options.release${isKotlin ? '.set(' : ' = '}${config.javaVersion}${isKotlin ? ')' : ''}
}
${extraBlock}
`.trimStart();
}

export function generateGradleProjectFiles(config: ProjectConfig): {
  files: Record<string, VirtualFile>;
  folders: string[];
} {
  const now = Date.now();
  const modId = sanitizeIdentifier(config.artifactId, 'craftforge');
  const pkgPath = config.groupId.replace(/\./g, '/');
  const mainClassName = toPascalCase(config.mainClass || config.name, 'CraftForgeMain');
  const isKotlin = config.dsl === 'kotlin';
  const buildFileName = isKotlin ? 'build.gradle.kts' : 'build.gradle';
  const settingsFileName = isKotlin ? 'settings.gradle.kts' : 'settings.gradle';
  const { minor } = parseMinecraftMinor(config.minecraftVersion);

  const files: Record<string, VirtualFile> = {};
  const addFile = (path: string, content: string) => {
    files[path] = { path, content, updatedAt: now };
  };

  addFile(buildFileName, generateBuildGradle(config));
  addFile(
    settingsFileName,
    isKotlin
      ? `pluginManagement {\n    repositories {\n        gradlePluginPortal()\n        mavenCentral()\n        maven("https://repo.papermc.io/repository/maven-public/")\n        maven("https://maven.fabricmc.net/")\n        maven("https://maven.minecraftforge.net/")\n        maven("https://maven.neoforged.net/releases")\n    }\n}\n\nrootProject.name = "${config.artifactId}"\n`
      : `pluginManagement {\n    repositories {\n        gradlePluginPortal()\n        mavenCentral()\n        maven { url = 'https://repo.papermc.io/repository/maven-public/' }\n        maven { url = 'https://maven.fabricmc.net/' }\n        maven { url = 'https://maven.minecraftforge.net/' }\n        maven { url = 'https://maven.neoforged.net/releases' }\n    }\n}\n\nrootProject.name = '${config.artifactId}'\n`
  );

  addFile(
    'gradle.properties',
    `# Configuração Gradle exclusiva para ${config.name}\norg.gradle.jvmargs=-Xmx2G -Dfile.encoding=UTF-8\norg.gradle.parallel=true\norg.gradle.caching=true\nminecraft_version=${config.minecraftVersion}\njava_version=${config.javaVersion}\nmod_id=${modId}\n`
  );

  addFile(
    'gradle/wrapper/gradle-wrapper.properties',
    `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-${config.gradleVersion}-bin.zip\nnetworkTimeout=10000\nvalidateDistributionUrl=true\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`
  );

  addFile(
    'gradlew',
    `#!/bin/sh\n# Gradle Wrapper POSIX Launcher (${config.gradleVersion})\nexec java -Xmx64m -Xms64m -jar "$(dirname "$0")/gradle/wrapper/gradle-wrapper.jar" "$@"\n`
  );

  const javaBase = `src/main/java/${pkgPath}`;

  if (config.platform === 'paper' || config.platform === 'spigot') {
    addFile(
      'src/main/resources/plugin.yml',
      `name: ${mainClassName}\nversion: '${config.version}'\nmain: ${config.groupId}.${mainClassName}\napi-version: '${minor >= 13 ? `1.${minor}` : '1.13'}'\ndescription: ${config.description}\ncommands:\n  ${modId}:\n    description: Comando principal do plugin ${config.name}\n    usage: /${modId}\n`
    );
    addFile(
      `${javaBase}/${mainClassName}.java`,
      `package ${config.groupId};

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class ${mainClassName} extends JavaPlugin implements Listener {

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("${config.name} ativado para Minecraft ${config.minecraftVersion} (Java ${config.javaVersion})");
    }

    @Override
    public void onDisable() {
        getLogger().info("${config.name} desativado com segurança.");
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        player.sendMessage("Bem-vindo ao servidor rodando ${config.name}!");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equalsIgnoreCase("${modId}")) {
            sender.sendMessage("[${config.name}] v${config.version} ativo em MC ${config.minecraftVersion}.");
            return true;
        }
        return false;
    }
}
`
    );
    addFile('src/main/resources/config.yml', `# Configuração padrão de ${config.name}\nenabled: true\nprefix: "&a[${config.name}] &f"\n`);
  } else if (config.platform === 'velocity') {
    addFile(
      `${javaBase}/${mainClassName}.java`,
      `package ${config.groupId};

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.ProxyServer;
import org.slf4j.Logger;

@Plugin(
    id = "${modId}",
    name = "${config.name}",
    version = "${config.version}",
    description = "${config.description}"
)
public class ${mainClassName} {

    private final ProxyServer server;
    private final Logger logger;

    @Inject
    public ${mainClassName}(ProxyServer server, Logger logger) {
        this.server = server;
        this.logger = logger;
    }

    @Subscribe
    public void onProxyInitialization(ProxyInitializeEvent event) {
        logger.info("${config.name} iniciado no Velocity (Java ${config.javaVersion})");
    }
}
`
    );
  } else if (config.platform === 'pvp-client') {
    const mixinId = `mixins.${modId}.json`;
    addFile(
      `src/main/resources/${mixinId}`,
      JSON.stringify(
        {
          required: true,
          minVersion: '0.8',
          package: `${config.groupId}.mixin`,
          compatibilityLevel: `JAVA_${config.javaVersion}`,
          client: ['MinecraftClientMixin'],
          injectors: { defaultRequire: 1 },
        },
        null,
        2
      )
    );
    if (minor >= 14) {
      addFile(
        'src/main/resources/fabric.mod.json',
        JSON.stringify(
          {
            schemaVersion: 1,
            id: modId,
            version: config.version,
            name: config.name,
            description: config.description,
            environment: 'client',
            entrypoints: { client: [`${config.groupId}.${mainClassName}`] },
            mixins: [mixinId],
            depends: {
              fabricloader: '>=0.16.0',
              minecraft: `~${config.minecraftVersion}`,
              java: `>=${config.javaVersion}`,
            },
          },
          null,
          2
        )
      );
    }
    addFile(
      `${javaBase}/${mainClassName}.java`,
      `package ${config.groupId};

import ${config.groupId}.module.ModuleManager;
import ${config.groupId}.hud.HudRenderer;

public final class ${mainClassName} {

    public static final String CLIENT_NAME = "${config.name}";
    public static final String MINECRAFT_VERSION = "${config.minecraftVersion}";
    private static ${mainClassName} instance;

    private final ModuleManager moduleManager;
    private final HudRenderer hudRenderer;

    public ${mainClassName}() {
        instance = this;
        this.moduleManager = new ModuleManager();
        this.hudRenderer = new HudRenderer(this.moduleManager);
    }

    public void init() {
        moduleManager.registerDefaults();
        System.out.println("[" + CLIENT_NAME + "] Client de PvP inicializado para MC " + MINECRAFT_VERSION + " (Java ${config.javaVersion})");
    }

    public static ${mainClassName} getInstance() {
        return instance;
    }

    public ModuleManager getModuleManager() {
        return moduleManager;
    }

    public HudRenderer getHudRenderer() {
        return hudRenderer;
    }
}
`
    );
    addFile(
      `${javaBase}/module/PvpModule.java`,
      `package ${config.groupId}.module;

public abstract class PvpModule {
    private final String name;
    private final Category category;
    private boolean enabled;
    private int keyBind;

    public enum Category {
        COMBAT, MOVEMENT, HUD, RENDER
    }

    protected PvpModule(String name, Category category, int keyBind) {
        this.name = name;
        this.category = category;
        this.keyBind = keyBind;
    }

    public void toggle() {
        this.enabled = !this.enabled;
        if (enabled) onEnable();
        else onDisable();
    }

    protected void onEnable() {}
    protected void onDisable() {}
    public void onTick() {}

    public String getName() { return name; }
    public Category getCategory() { return category; }
    public boolean isEnabled() { return enabled; }
    public int getKeyBind() { return keyBind; }
    public void setKeyBind(int keyBind) { this.keyBind = keyBind; }
}
`
    );
    addFile(
      `${javaBase}/module/ModuleManager.java`,
      `package ${config.groupId}.module;

import ${config.groupId}.module.impl.ToggleSprintModule;
import ${config.groupId}.module.impl.KeystrokesModule;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class ModuleManager {
    private final List<PvpModule> modules = new ArrayList<>();

    public void registerDefaults() {
        modules.add(new ToggleSprintModule());
        modules.add(new KeystrokesModule());
    }

    public List<PvpModule> getModules() {
        return Collections.unmodifiableList(modules);
    }

    public void onTickAll() {
        for (PvpModule mod : modules) {
            if (mod.isEnabled()) {
                mod.onTick();
            }
        }
    }
}
`
    );
    addFile(
      `${javaBase}/module/impl/ToggleSprintModule.java`,
      `package ${config.groupId}.module.impl;

import ${config.groupId}.module.PvpModule;

public class ToggleSprintModule extends PvpModule {
    public ToggleSprintModule() {
        super("ToggleSprint", Category.MOVEMENT, 0);
    }

    @Override
    public void onTick() {
        // Hook via Mixin para manter sprint ativo durante PvP
    }
}
`
    );
    addFile(
      `${javaBase}/module/impl/KeystrokesModule.java`,
      `package ${config.groupId}.module.impl;

import ${config.groupId}.module.PvpModule;

public class KeystrokesModule extends PvpModule {
    private int leftCps;
    private int rightCps;

    public KeystrokesModule() {
        super("Keystrokes & CPS", Category.HUD, 0);
    }

    public void recordClick(boolean left) {
        if (left) leftCps++;
        else rightCps++;
    }

    public int getLeftCps() { return leftCps; }
    public int getRightCps() { return rightCps; }
}
`
    );
    addFile(
      `${javaBase}/hud/HudRenderer.java`,
      `package ${config.groupId}.hud;

import ${config.groupId}.module.ModuleManager;
import ${config.groupId}.module.PvpModule;

public class HudRenderer {
    private final ModuleManager moduleManager;

    public HudRenderer(ModuleManager moduleManager) {
        this.moduleManager = moduleManager;
    }

    public void renderOverlay(int screenWidth, int screenHeight) {
        int y = 8;
        for (PvpModule mod : moduleManager.getModules()) {
            if (mod.isEnabled()) {
                // Renderiza módulo ativo no HUD
                y += 12;
            }
        }
    }
}
`
    );
    addFile(
      `${javaBase}/mixin/MinecraftClientMixin.java`,
      `package ${config.groupId}.mixin;

import org.spongepowered.asm.mixin.Mixin;

// Alvo ajustável conforme mapeamentos Yarn/MCP da versão ${config.minecraftVersion}
public class MinecraftClientMixin {
}
`
    );
  } else if (config.platform === 'fabric') {
    addFile(
      'src/main/resources/fabric.mod.json',
      JSON.stringify(
        {
          schemaVersion: 1,
          id: modId,
          version: config.version,
          name: config.name,
          description: config.description,
          environment: '*',
          entrypoints: { main: [`${config.groupId}.${mainClassName}`] },
          depends: {
            fabricloader: '>=0.16.0',
            minecraft: `~${config.minecraftVersion}`,
            java: `>=${config.javaVersion}`,
            'fabric-api': '*',
          },
        },
        null,
        2
      )
    );
    addFile(
      `${javaBase}/${mainClassName}.java`,
      `package ${config.groupId};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${mainClassName} implements ModInitializer {
    public static final String MOD_ID = "${modId}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("${config.name} carregado no Fabric ${config.minecraftVersion} (Java ${config.javaVersion})");
    }
}
`
    );
  } else {
    // Forge or NeoForge
    const isNeo = config.platform === 'neoforge';
    addFile(
      isNeo ? 'src/main/resources/META-INF/neoforge.mods.toml' : 'src/main/resources/META-INF/mods.toml',
      `modLoader="javafml"\nloaderVersion="[1,)"\nlicense="MIT"\n\n[[mods]]\nmodId="${modId}"\nversion="${config.version}"\ndisplayName="${config.name}"\ndescription='''${config.description}'''\n`
    );
    addFile(
      `${javaBase}/${mainClassName}.java`,
      `package ${config.groupId};

public class ${mainClassName} {
    public static final String MOD_ID = "${modId}";

    public ${mainClassName}() {
        System.out.println("${config.name} inicializado em ${isNeo ? 'NeoForge' : 'Forge'} ${config.minecraftVersion} (Java ${config.javaVersion})");
    }
}
`
    );
  }

  const folderSet = new Set<string>();
  for (const filePath of Object.keys(files)) {
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join('/'));
    }
  }

  return {
    files,
    folders: Array.from(folderSet).sort(),
  };
}

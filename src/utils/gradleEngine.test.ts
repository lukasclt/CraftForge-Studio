import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateGradleProjectFiles,
  getRecommendedGradleForJava,
  getRecommendedJavaForMinecraft,
  validateGradleSetup,
} from './gradleEngine';
import type { ProjectConfig } from '../types/ide';

test('recommends correct Java version across Minecraft eras', () => {
  assert.equal(getRecommendedJavaForMinecraft('1.7.10'), 8);
  assert.equal(getRecommendedJavaForMinecraft('1.8.9'), 8);
  assert.equal(getRecommendedJavaForMinecraft('1.16.5'), 8);
  assert.equal(getRecommendedJavaForMinecraft('1.17.1'), 16);
  assert.equal(getRecommendedJavaForMinecraft('1.20.4'), 17);
  assert.equal(getRecommendedJavaForMinecraft('1.21.4'), 21);
});

test('generates Paper plugin with Java 21 Toolchain in Gradle', () => {
  const config: ProjectConfig = {
    name: 'SkyWarsCore',
    platform: 'paper',
    minecraftVersion: '1.21.4',
    javaVersion: 21,
    gradleVersion: getRecommendedGradleForJava(21, 'paper', '1.21.4'),
    dsl: 'groovy',
    groupId: 'br.dev.skywars',
    artifactId: 'skywarscore',
    version: '1.0.0',
    mainClass: 'SkyWarsCore',
    description: 'SkyWars plugin',
    dependencies: ['net.luckperms:api:5.4'],
  };

  const { files } = generateGradleProjectFiles(config);
  assert.ok(files['build.gradle']);
  assert.ok(files['settings.gradle']);
  assert.ok(files['gradle/wrapper/gradle-wrapper.properties']);
  assert.ok(files['src/main/resources/plugin.yml']);
  assert.ok(files['src/main/java/br/dev/skywars/SkyWarsCore.java']);
  assert.match(files['build.gradle'].content, /JavaLanguageVersion\.of\(21\)/);
  assert.match(files['build.gradle'].content, /paper-api:1\.21\.4/);

  const validation = validateGradleSetup(config, files);
  assert.equal(validation.valid, true);
});

test('generates 1.8.9 PvP Client with Mixin and Java 8 via Gradle', () => {
  const config: ProjectConfig = {
    name: 'VeloClient',
    platform: 'pvp-client',
    minecraftVersion: '1.8.9',
    javaVersion: 8,
    gradleVersion: getRecommendedGradleForJava(8, 'pvp-client', '1.8.9'),
    dsl: 'groovy',
    groupId: 'gg.velocraft.client',
    artifactId: 'velocraft',
    version: '2.0.0',
    mainClass: 'VeloClient',
    description: 'Client de PvP 1.8.9',
    dependencies: [],
  };

  const { files } = generateGradleProjectFiles(config);
  assert.ok(files['build.gradle']);
  assert.ok(files['src/main/resources/mixins.velocraft.json']);
  assert.ok(files['src/main/java/gg/velocraft/client/module/ModuleManager.java']);
  assert.ok(files['src/main/java/gg/velocraft/client/module/impl/ToggleSprintModule.java']);
  assert.match(files['build.gradle'].content, /JavaLanguageVersion\.of\(8\)/);
  assert.match(files['build.gradle'].content, /spongepowered:mixin/);
});

test('flags incompatible Java version for Minecraft 1.21.4', () => {
  const config: ProjectConfig = {
    name: 'BrokenMod',
    platform: 'fabric',
    minecraftVersion: '1.21.4',
    javaVersion: 8,
    gradleVersion: '8.11.1',
    dsl: 'kotlin',
    groupId: 'com.example.mod',
    artifactId: 'brokenmod',
    version: '1.0.0',
    mainClass: 'BrokenMod',
    description: 'Fabric mod',
    dependencies: [],
  };
  const { files } = generateGradleProjectFiles(config);
  assert.ok(files['build.gradle.kts']);
  const validation = validateGradleSetup(config, files);
  assert.equal(validation.valid, false);
  assert.ok(validation.diagnostics.some((d) => d.code === 'JAVA_TOO_OLD_FOR_MC'));
});

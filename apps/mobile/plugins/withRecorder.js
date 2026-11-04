const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withMainApplication, withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');
module.exports = function withRecorder(config) {
 config = withAndroidManifest(config, mod => {
  const manifest = mod.modResults.manifest;
  manifest['uses-permission'] ||= [];
  for (const name of ['android.permission.FOREGROUND_SERVICE','android.permission.FOREGROUND_SERVICE_MICROPHONE','android.permission.FOREGROUND_SERVICE_DATA_SYNC','android.permission.POST_NOTIFICATIONS','android.permission.WAKE_LOCK']) {
   if (!manifest['uses-permission'].some(p => p.$['android:name'] === name)) manifest['uses-permission'].push({$: {'android:name': name}});
  }
  const app = manifest.application[0]; app.service ||= [];
  if (!app.service.some(s => s.$['android:name'] === 'com.jewelos.mobile.recorder.RecorderService')) app.service.push({$: {'android:name':'com.jewelos.mobile.recorder.RecorderService','android:exported':'false','android:foregroundServiceType':'microphone|dataSync','android:stopWithTask':'false'}});
  return mod;
 });
 config = withMainApplication(config, mod => {
  if (!mod.modResults.contents.includes('add(com.jewelos.mobile.recorder.RecorderPackage())')) {
   mod.modResults.contents = mod.modResults.contents.replace('PackageList(this).packages.apply {','PackageList(this).packages.apply {\n          add(com.jewelos.mobile.recorder.RecorderPackage())');
  }
  return mod;
 });
 config = withAppBuildGradle(config, mod => {
  if (!mod.modResults.contents.includes('android.test.InstrumentationTestRunner')) mod.modResults.contents += "\nandroid.defaultConfig.testInstrumentationRunner = \"android.test.InstrumentationTestRunner\"\nandroid.useLibrary \"android.test.runner\", false\nandroid.useLibrary \"android.test.base\", false\n";
  return mod;
 });
 return withDangerousMod(config, ['android', async mod => {
  const target=path.join(mod.modRequest.platformProjectRoot,'app/src/main/java/com/jewelos/mobile/recorder');
  fs.mkdirSync(target,{recursive:true});
  const source=path.join(mod.modRequest.projectRoot,'src/features/webShell/native');
  for (const file of fs.readdirSync(source).filter(f=>f.endsWith('.kt'))) fs.copyFileSync(path.join(source,file),path.join(target,file));
  const tests=path.join(mod.modRequest.platformProjectRoot,'app/src/androidTest/java/com/jewelos/mobile/recorder');
  fs.mkdirSync(tests,{recursive:true});
  fs.copyFileSync(path.join(mod.modRequest.projectRoot,'src/features/webShell/nativeTests/RecorderQueueTest.kt'),path.join(tests,'RecorderQueueTest.kt'));
  return mod;
 }]);
};

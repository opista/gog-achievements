const fs = require('node:fs');
const path = require('node:path');
const target =
  process.env.GOG_CLI_TARGET ||
  `${process.platform === 'darwin' ? 'macos' : 'windows'}-${process.arch}`;
if (!/^(macos|windows)-(arm64|x64)$/.test(target)) throw new Error('Unsupported CLI target.');
const icon = path.join(__dirname, 'resources/ui/assets/app-icon.png');
module.exports = {
  appId: 'com.metacurb.gogachievements',
  productName: 'GOG Achievements',
  asar: true,
  // Updates use browser downloads. Do not generate an automatic update feed.
  publish: null,
  directories: { output: 'dist', buildResources: 'resources' },
  files: ['out/**/*', 'package.json'],
  extraResources: [{ from: `resources/cli/${target}`, to: 'cli', filter: ['**/*'] }],
  artifactName: 'gog-achievements-${version}-' + target + '.${ext}',
  ...(fs.existsSync(icon) ? { icon } : {}),
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.utilities',
    minimumSystemVersion: '13.5',
    hardenedRuntime: true,
  },
  win: { target: ['nsis'] },
  nsis: {
    buildUniversalInstaller: false,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};

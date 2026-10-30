// Configuration Karma de l'image : celle du projet est chargée si elle existe, sinon les réglages qu'Angular
// applique d'ordinaire (ignorés dès qu'une configuration est fournie) ; la couverture et le navigateur sont imposés.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');

module.exports = function (config) {
  const projet = path.join(process.cwd(), 'karma.conf.js');
  if (fs.existsSync(projet)) {
    require(projet)(config);
  } else {
    const requireProjet = createRequire(process.cwd() + '/');
    config.set({
      frameworks: ['jasmine'],
      plugins: ['karma-jasmine', 'karma-chrome-launcher', 'karma-coverage'].map(p => requireProjet(p)),
      reporters: ['progress'],
    });
  }
  config.set({
    browsers: ['ChromeHeadlessConteneur'],
    customLaunchers: { ChromeHeadlessConteneur: { base: 'ChromeHeadless', flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] } },
    singleRun: true,
    autoWatch: false,
    coverageReporter: { dir: '/workspace/analyse/angular-couverture', subdir: '.', reporters: [{ type: 'cobertura', file: 'cobertura.xml' }] },
  });
};

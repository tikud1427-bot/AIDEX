'use strict';

document.addEventListener('DOMContentLoaded', function () {
  const upgradeButton = document.getElementById('upgrade-button');
  if (upgradeButton) {
    upgradeButton.addEventListener('click', function () {
      console.log('Upgrading...');
    });
  }
});
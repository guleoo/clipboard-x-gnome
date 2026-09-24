import {uniqueApplications} from '../../src/common/running-apps.js';

const applications = uniqueApplications([
  {name: 'Terminal', wmClass: 'org.gnome.Console'},
  {name: 'Terminal', wmClass: 'org.gnome.Console'},
  {name: 'Browser', wmClass: 'firefox'},
  {name: 'Duplicate', wmClass: 'Firefox'},
  {name: 'Unknown', wmClass: ''},
  {name: '', wmClass: 'special-app'},
]);
if (applications.length !== 3
    || applications[0].wmClass !== 'firefox'
    || applications[1].wmClass !== 'special-app'
    || applications[2].wmClass !== 'org.gnome.Console'
    || applications[1].name !== 'special-app')
  throw new Error('Running window choices must use distinct, nonempty window classes');

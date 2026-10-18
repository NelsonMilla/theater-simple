'use strict';
const sourcesElement = document.getElementById('sources');
document.getElementById('cancel').addEventListener('click', () => window.theaterPicker.choose(null));
window.theaterPicker.sources().then(sources => {
  for (const source of sources) {
    const button = document.createElement('button');
    const image = document.createElement('img');
    image.src = source.thumbnail;
    image.alt = '';
    const label = document.createElement('span');
    label.textContent = source.name;
    button.append(image, label);
    button.addEventListener('click', () => window.theaterPicker.choose(source.id));
    sourcesElement.append(button);
  }
  if (!sources.length) document.getElementById('error').textContent = 'No presentation windows were found. Open your presentation and try again.';
}).catch(() => { document.getElementById('error').textContent = 'Could not list windows. Close this dialog and try again.'; });

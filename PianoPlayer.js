import { Piano } from "@tonejs/piano";

const DEFAULT_VELOCITIES = 4; // Number of piano sample velocities to use for playback
const BASE_DATA_URL = "http://localhost/~pmb/broadwell.github.io/piano_rolls/";

//let globalPiano = null;

// create the piano and load velocity steps
let piano = new Piano({
  url: BASE_DATA_URL + 'audio/mp3/', // works if avaialable
  velocities: DEFAULT_VELOCITIES,
  release: true,
  pedal: true,
  maxPolyphony: 64,
}).toDestination();

let loadPiano = piano.load();
Promise.all([loadPiano]).then(() => {
  console.log("Piano loaded");
  postMessage("ready");
  // These need to be done in main thread via callback
  //document.getElementById("playPause").disabled = false;
  //keyboard.enable();
  //globalPiano = piano;
});

onmessage = (e) => {
  switch(e.action) {
    case("keyDown"):
      piano.keyDown({ midi: e.noteNumber, velocity: e.volume });
      break;
    case("keyUp"):
      piano.keyUp({ midi: e.noteNumber });
      break;
    case("pedalDown"):
      piano.pedalDown({ level: e.sustainRatio });
      break;
    case("pedalUp"):
      piano.pedalUp();
      break;
  }
}
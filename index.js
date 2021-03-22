import MidiPlayer from "midi-player-js"; // Decodes and plays back MIDI data
import OpenSeadragon from "openseadragon";
import IntervalTree from "node-interval-tree";
import verovio from "verovio";
import { v4 as uuidv4 } from "uuid";
import Keyboard from "piano-keyboard";
import { Piano } from "@tonejs/piano";

const UPDATE_INTERVAL_MS = 100;
const SHARP_NOTES = [
  "A",
  "A#",
  "B",
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
];
const FLAT_NOTES = [
  "A",
  "Bb",
  "B",
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
];
const SOFT_PEDAL_RATIO = 0.67; // Pedal shifts hammers so only 2/3 strings are struck (usually)
const DEFAULT_NOTE_VELOCITY = 33.0; // Only applies to manual keypresses and non-expression rolls
const HALF_BOUNDARY = 66; // F# above Middle C; divides the keyboard into two "pans"
const DEFAULT_VELOCITIES = 4; // Number of piano sample velocities to use for playback
const HOME_ZOOM = 1;
const ACCENT_BUMP = 1.5; // Multiple to increase velocity while the accent button is pressed
const TEMPO_KEY_DELTA = 5; // Number of tempo "bpm" to + or - on keyboard input
const VOLUME_KEY_DELTA = .2; // Proportion to + or - volume on keyboard input
const VOL_ACCENT_MOD_DELTA = .5;
const PEDAL_TEMPO_MOD_DELTA = .4;
const BASE_DATA_URL = "https://broadwell.github.io/piano_rolls/";
const SUSTAIN_PEDAL_KEY = "KeyC";
const SOFT_PEDAL_KEY = "KeyQ";
const TEMPO_SLOWER_KEY = "KeyW";
const TEMPO_FASTER_KEY = "KeyE";
const PEDAL_TEMPO_MODIFY_KEY = "ShiftLeft";
const VOLUME_DOWN_KEY = "BracketLeft";
const VOLUME_UP_KEY = "BracketRight";
const ACCENT_KEY = "Comma";
const VOL_ACCENT_MODIFY_KEY = "ShiftRight";
const SUSTAIN_LESS_KEY = "KeyB";
const SUSTAIN_MORE_KEY = "KeyN";
const SUSTAIN_LEVEL_DELTA = 5;
//const BASE_DATA_URL = "http://localhost/~pmb/broadwell.github.io/piano_rolls/";

//let midiData = require("./mididata.json");
let scoreData = require("./scoredata.mei.json");

const recordings_data = {
  zb497jz4405: {
    slug: "mozart_rondo_alla_turca",
    title: "Mozart/Reinecke - Türkischer Marsch",
    image_url:
      "https://stacks.stanford.edu/image/iiif/zb497jz4405%2Fzb497jz4405_0001/info.json",
  },
  yj598pj2879: {
    slug: "liszt_soirees_de_vienne",
    title: "Liszt/Carreño - Soirées de Vienne, no. 6",
    image_url:
      "https://stacks.stanford.edu/image/iiif/yj598pj2879%2Fyj598pj2879_0001/info.json",
  },
  pz594dj8436: {
    slug: "alonso_las_corsarias",
    title: "F. Alonso: Las corsarias: Selecciones",
    image_url:
      "https://stacks.stanford.edu/image/iiif/pz594dj8436%2Fpz594dj8436_0002/info.json",
  },
  dj406yq6980: {
    slug: "brassin_magic_fire",
    title: "Brassin-Wagner/Hofmann - Feuerzauber",
    image_url:
      "https://stacks.stanford.edu/image/iiif/dj406yq6980%2Fdj406yq6980_0001/info.json",
  },
  rx870zt5437: {
    slug: "peterossi_tango_argentino",
    title: "Peterossi: Galleguita: tango argentino",
    image_url:
      "https://stacks.stanford.edu/image/iiif/rx870zt5437%2Frx870zt5437_0002/info.json",
  },
  wt621xq0875: {
    slug: "lamond_pathetique",
    title: "Beethoven/Lamond: Sonate pathétique",
    image_url:
      "https://stacks.stanford.edu/image/iiif/wt621xq0875%2Fwt621xq0875_0001/info.json",
  },
  kr397bv2881: {
    slug: "lamond_pathetique_mvt3",
    title: "Beethoven/Lamond: Sonate pathétique mvt. 3",
    image_url:
      "https://stacks.stanford.edu/image/iiif/kr397bv2881%2Fkr397bv2881_0001/info.json",
  }
};

let currentRecording = null;
let rollMetadata = {};
let samplePlayer = null; // the MIDI player
let scorePlayer = null;
let playState = "stopped";
let totalTicks = 0;
let currentTick = 0;
let currentProgress = 0.0;
let volumeRatio = 1.0;
let leftVolumeRatio = 1.0;
let rightVolumeRatio = 1.0;
let baseTempo = 60.0;
let midiTempo = 60.0
let tempoRatio = 1.0;
let sliderTempo = 60.0;
let playbackTempo = 0.0;
let activeNotes = [];
let sustainPedalOn = false;
let softPedalOn = false;
let sustainPedalLocked = false;
let softPedalLocked = false;
let sustainLevel = 127;
let panBoundary = HALF_BOUNDARY;
let pedalMap = null;
let tempoMap = null;
let playComputedExpressions = true;
let useRollPedaling = true;
let accentOn = false;
let pedalTempoModOn = false;
let volAccentModDelta = 1;
let pedalTempoModDelta = 1;
let useMidiTempos = true;

let showRoll = false;
let openSeadragon = null;
let firstHolePx = 0;
let scrollTimer = null;
let viewerId = uuidv4();
let overlayPersist = 100; // # ticks = pixels on original roll image
let holeOverlays = {}; // key = tick, value = div
let holeWidth = 0;
let holeSep = 0;

/* Defaults for time-based acceleration emulation */
let rollPPI = 300.0;
let timeQuantumInTicks = 12.0 * rollPPI;
let accelRate = .0022;

let showScore = false;
let noScore = true;
let scoreStorage = null;
let recordingSlug = null;
let scorePages = [];
let scoreMIDI = [];
let scorePlaying = false;
let currentScorePage = 1;
let highlightedNotes = [];
let currentRecordingId = Object.keys(recordings_data)[1];
let vrvToolkit = null;

let scrollUp = false;

let keyboard = null;

const startNote = function (noteNumber, velocity) {
  if (velocity === null) {
    velocity = DEFAULT_NOTE_VELOCITY / 128.0;
  }

  if (accentOn) {
    velocity = velocity * (ACCENT_BUMP * volAccentModDelta);
  }

  velocity = Math.min(velocity, 1.0);

  if (velocity > 0) {
    piano.keyDown({ midi: noteNumber, velocity: velocity });
  }
  keyboardToggleKey(noteNumber, true);
};

const stopNote = function (noteNumber) {
  piano.keyUp({ midi: noteNumber });
  keyboardToggleKey(noteNumber, false);
};

const initScorePlayer = function () {

  scorePlayer = null;

  if (recordingSlug in scoreData) {
    noScore = false;
    document.getElementById("showScore").disabled = false;
  } else {
    noScore = true;
    document.getElementById("showScore").disabled = true;
  }

  if (!showScore || noScore) {
    if (document.getElementById("scoreWrapper").hasChildNodes()) {
      let scoreNode = document.getElementById("scoreWrapper").children[0];
      if (scoreNode) {
        scoreStorage = scoreNode.cloneNode(true);
        scoreNode.remove();
      }
    }
    return;
  }

  /* load the MEI data as a string into the toolkit */

  if (showScore && !noScore) {

    if (scoreStorage) {
      document.getElementById("scoreWrapper").appendChild(scoreStorage);
    }

    vrvToolkit.loadData(scoreData[recordingSlug]);

    /* render the fist page as SVG */
    scorePages = [];
    for (let i = 1; i <= vrvToolkit.getPageCount(); i++) {
      scorePages.push(vrvToolkit.renderToSVG(i, {}));
    }

    document.getElementById("scorePage").innerHTML =
      scorePages[currentScorePage - 1];

    scoreMIDI = "data:audio/midi;base64," + vrvToolkit.renderToMIDI();

    /* Instantiate the score MIDI player */
    scorePlayer = new MidiPlayer.Player();

    scorePlayer.on("midiEvent", function (e) {
      const timeMultiplier =
        parseFloat(scorePlayer.getSongTime() * 1000.0) /
        parseFloat(scorePlayer.totalTicks);

      let vrvTime = parseInt(e.tick * timeMultiplier) + 1;

      let elementsattime = vrvToolkit.getElementsAtTime(vrvTime);

      let lastNoteIds = highlightedNotes;
      if (lastNoteIds && lastNoteIds.length > 0) {
        lastNoteIds.forEach((noteId) => {
          let noteElt = document.getElementById(noteId);
          if (noteElt) {
            noteElt.setAttribute("style", "fill: #000");
          }
        });
      }

      if (elementsattime.page > 0) {
        if (elementsattime.page != currentScorePage) {
          currentScorePage = elementsattime.page;
          document.getElementById("scorePage").innerHTML =
            scorePages[currentScorePage - 1];
        }
      }

      let noteIds = elementsattime.notes;
      if (noteIds && noteIds.length > 0) {
        noteIds.forEach((noteId) => {
          let noteElt = document.getElementById(noteId);
          if (noteElt) {
            noteElt.setAttribute("style", "fill: #c00");
          }
        });
      }
      highlightedNotes = noteIds;

      midiEvent(e);
    });

    scorePlayer.on("endOfFile", function () {
      console.log("END OF FILE");
      scorePlaying = false;
      // Do something when end of the file has been reached.
    });

    // Load MIDI data
    scorePlayer.loadDataUri(scoreMIDI);
  }

}

const loadRecording = function (e, newRecordingId) {
  if (e) {
    currentRecordingId = e.target.value;
  } else {
    currentRecordingId = newRecordingId;
  }

  if (samplePlayer && (samplePlayer.isPlaying() || playState === "paused")) {
    samplePlayer.stop();
    playState = "stopped";
  }
  clearScrollTimer();
  activeNotes.forEach((noteNumber) => {
    keyboardToggleKey(noteNumber, false);
  });
  activeNotes = [];
  highlightedNotes = [];
  releaseSustainPedal();
  softPedalOn = false;
  document.getElementById("softPedal").classList.remove("pressed");

  console.log("loading recording ID", currentRecordingId);

  document.getElementById("recordings").value = currentRecordingId;

  recordingSlug = recordings_data[currentRecordingId]["slug"];
  //currentRecording = midiData[recordingSlug];

  initPlayer();

  initScorePlayer();

};

const loadRecordingData = function(data) {
  if (data !== undefined) {
    currentRecording = data;
    samplePlayer.loadArrayBuffer(currentRecording);
  }
}

const initPlayer = function () {

  /* Instantiate the MIDI player */
  samplePlayer = new MidiPlayer.Player();

  /* Various event handlers, mostly used for debugging */
  samplePlayer.on("fileLoaded", () => {
    console.log("data loaded");

    function decodeCharRefs(string) {
      return string
        .replace(/&#(\d+);/g, function (match, num) {
          return String.fromCodePoint(num);
        })
        .replace(/&#x([A-Za-z0-9]+);/g, function (match, num) {
          return String.fromCodePoint(parseInt(num, 16));
        });
    }

    firstHolePx = 0;
    let lastHolePx = 0;
    let holeWidthPx = 0;
    rollMetadata = {};
    const metadataRegex = /^@(?<key>[^:]*):[\t\s]*(?<value>.*)$/;
    let tempoChanges = [];

    pedalMap = new IntervalTree();

    // Pedal events should be duplicated on each track, but best not to assume
    // this will always be the case. Assume however that the events are
    // always temporally ordered in each track.
    samplePlayer.events.forEach((track, t) => {
      let sustainOn = false;
      let softOn = false;
      let sustainStart = 0;
      let softStart = 0;

      //console.log("TRACK",t,"EVENTS",track);

      track.forEach((event) => {
        if (event.name === "Controller Change") {
          // Sustain pedal on/off
          if (event.number == 64) {
            if (event.value == 127 && sustainOn != true) {
              sustainOn = true;
              sustainStart = event.tick;
            } else if (event.value == 0) {
              sustainOn = false;
              pedalMap.insert(sustainStart, event.tick, "sustain");
            }
            // Soft pedal on/off
          } else if (event.number == 67) {
            // Consecutive "on" events just mean "yep, still on" ??
            if (event.value == 127 && softOn != true) {
              softOn = true;
              softStart = event.tick;
            } else if (event.value == 0) {
              softOn = false;
              pedalMap.insert(softStart, event.tick, "soft");
            }
          }
        } else if (event.name === "Set Tempo") {
          tempoChanges.push([parseInt(event.tick), parseFloat(event.data)]);
        } else if (event.name === "Text Event") {
          let text = decodeCharRefs(event.string);
          if (!text) return;
          const found = text.match(metadataRegex);
          rollMetadata[found.groups.key] = found.groups.value;
        }
      });
    });

    totalTicks = samplePlayer.totalTicks;

    let sortedTempoChanges = tempoChanges.sort(function(a, b) {
      return a[0] - b[0];
    });

    tempoMap = new IntervalTree();

    console.log("LENGTH-BASED ACCELERATION MAP (FROM MIDI FILE)");

    sortedTempoChanges.forEach((item, i) => {
      if (i == 0) {
        baseTempo = item[1];
      }

      if (i < sortedTempoChanges.length - 1) {
        console.log(item[0], sortedTempoChanges[i+1][0] -1, item[1]);
        tempoMap.insert(item[0], sortedTempoChanges[i+1][0] - 1, item[1]);
      } else {
        console.log(item[0], totalTicks, item[1]);
        tempoMap.insert(item[0], totalTicks, item[1]);
      }
    });

    let timeTempoMap = new IntervalTree();

    // Use 'LENGTH_DPI' for the roll PPI? It's hardcoded at 300 but is often
    // given as 300.25ppi on the roll metadata.
    if ('ACCEL_INCH' in rollMetadata) {
      timeQuantumInTicks = parseFloat(rollMetadata['ACCEL_INCH']) * rollPPI;
    }
    if ('ACCEL_PERCENT' in rollMetadata) {
      accelRate = parseFloat(rollMetadata['ACCEL_PERCENT']) / 100.0;
    }
    let accelFactor = 1.0;
    let thisTempo = baseTempo;
    let thisTime = 0.0;

    console.log("TIME-BASED ACCELERATION MAP");

    while (thisTime < totalTicks) {
      
      let nextTime = thisTime + Math.floor(timeQuantumInTicks * accelFactor);
      thisTempo = parseInt(baseTempo * accelFactor);

      if (nextTime > totalTicks) {
        nextTime = totalTicks + 1;
      }

      console.log(thisTime, nextTime-1, thisTempo);

      timeTempoMap.insert(thisTime, nextTime-1, thisTempo);

      thisTime = nextTime;
      accelFactor += accelRate;
    }

    console.log(rollMetadata);

    document.getElementById("title").innerText = rollMetadata["TITLE"];
    let performer = rollMetadata["PERFORMER"];
    if (rollMetadata["PERFORMER"] === undefined) {
      performer = "N/A";
    }
    document.getElementById("performer").innerText = performer;
    document.getElementById("composer").innerText = rollMetadata["COMPOSER"];
    document.getElementById("label").innerText = rollMetadata["LABEL"];
    document.getElementById("purl").innerHTML =
      '<a href="' + rollMetadata["PURL"] + '">' + rollMetadata["PURL"] + "</a>";
    document.getElementById('callno').innerText = rollMetadata['CALLNUM'];

    scrollUp = false;
    document.getElementById("playExpressions").disabled = false;
    document.getElementById("useRollPedaling").disabled = false;
    if (rollMetadata["ROLL_TYPE"] !== "welte-red") {
      scrollUp = true;
      document.getElementById("playExpressions").disabled = true;
      document.getElementById("useRollPedaling").disabled = true;
    }

    firstHolePx = parseInt(rollMetadata["FIRST_HOLE"]);
    if (scrollUp) {
      firstHolePx = parseInt(rollMetadata["IMAGE_LENGTH"]) - firstHolePx;
    }

    //console.log("FIRST HOLE",firstHolePx);

    lastHolePx = parseInt(rollMetadata["LAST_HOLE"]);
    holeWidthPx = parseInt(rollMetadata["AVG_HOLE_WIDTH"]);

    let rollWidth = parseInt(rollMetadata["ROLL_WIDTH"]);

    holeWidth = parseFloat(rollMetadata['AVG_HOLE_WIDTH'].replace('px',''));
    holeSep = parseFloat(rollMetadata['HOLE_SEPARATION'].replace('px',''));

    updateProgress();

    if (showRoll) {
      openSeadragon.open(recordings_data[currentRecordingId]["image_url"]);

      openSeadragon.addOnceHandler("update-viewport", () => {
        panViewportToTick(0);
      });
    }
    currentTick = 0;
    playerProgress();

  });

  samplePlayer.on("playing", (currentTick) => {
    // Do something while player is playing
    // (this is repeatedly triggered within the play loop)
  });

  samplePlayer.on("midiEvent", midiEvent);

  samplePlayer.on("endOfFile", function () {
    console.log("END OF FILE");
    stopPlayback();
    // Do something when end of the file has been reached.
    panViewportToTick(0);
  });

  // Load the raw MIDI if the expression MIDI is not available
  // XXX There's probably a more elegant way to do this...
  // XXX Would be nice to be able to load this directly from SDR, but
  // so far, only the records that are in a Spotlight exhibit have
  // their MIDI files in the SDR!
  // MIDI files for Welte red rolls are at
  // https://raw.githubusercontent.com/pianoroll/SUPRA/master/welte-red/midi-exp/[ID]_exp.mid
  // (but not for the Garcia-Sampedro rolls)
  fetch(BASE_DATA_URL + 'midi/' + currentRecordingId + '_exp.mid')
    .then(response => {
      if (!response.ok) {
        throw new Error('Network error');
      }
      return response.arrayBuffer();
    })
    .catch(error => {
      fetch(BASE_DATA_URL + 'midi/' + currentRecordingId + '_note.mid')
        .then(response => response.arrayBuffer())
        .then(data => {
          loadRecordingData(data);
        });
    })
    .then(data => {
      loadRecordingData(data);
    });
};

const clearOverlays = function(newTick, allIfTrue) {

  if (!showRoll) {
    return;
  }

  Object.keys(holeOverlays).forEach(tick => {
    if (allIfTrue || (Math.abs(newTick - tick) > overlayPersist)) {
      holeOverlays[tick].forEach(item => {
        openSeadragon.viewport.viewer.removeOverlay(item);
      });
      delete holeOverlays[tick];
    }
  });
}

const midiEvent = function (event) {

  clearOverlays(event.tick, false);

  let linePx = firstHolePx + event.tick;
  if (scrollUp) {
    linePx = firstHolePx - event.tick;
  }

  //console.log("MIDI EVENT AT TICK",event.tick,"PIXEL",linePx);

  /* Useful numbers for aligning overlays with roll: */
  /*
  rollMetadata['AVG_HOLE_WIDTH']
  rollMetadata['HARD_MARGIN_BASS']
  rollMetadata['HARD_MARGIN_TREBLE']
  rollMetadata['HOLE_OFFSET']
  rollMetadata['HOLE_SEPARATION']
  rollMetadata['ROLL_TYPE'] // usually 88 keys, eventually some may have 65
  */

  if (event.name === "Note on") {
    const noteNumber = event.noteNumber;

    // Note off
    if ((event.velocity === 0) && (event.track <= 3)) {

      while (activeNotes.includes(parseInt(noteNumber))) {
        activeNotes.splice(activeNotes.indexOf(parseInt(noteNumber)), 1);
      }
      stopNote(noteNumber);
      //console.log("OFF",getNoteName(noteNumber));
      //}
      // Note on
    } else {

      if (showRoll) {
        // The use of holeSep seems to be correct, but the X offset is a total guess
        let noteOffset = 0;

        if (rollMetadata["ROLL_TYPE"] !== "welte-red") {
          noteOffset = noteNumber - 4;
        } else {
          noteOffset = noteNumber - 10;
        }

        let dotX = noteOffset * holeSep;
        
        if (event.track <= 3) {
          dotX += parseInt(parseFloat(holeWidth) / 2.0);
        }

        let scaleFactor = openSeadragon.viewport.viewportToImageZoom(openSeadragon.viewport.getZoom());

        let dotRadius = holeWidth * scaleFactor;

        let noteDot = document.createElement("div");
        if (event.track <= 3) {
          noteDot.classList.add('music-hole-dot');
        } else {
          noteDot.classList.add('control-hole-dot')
        }
        noteDot.style.height = dotRadius.toString() + 'px';
        noteDot.style.width = dotRadius.toString() + 'px';

        let dotY = linePx;
        if (event.track <= 3) {
          if (!scrollUp) {
            dotY += holeWidth;
          }
        }

        let dotViewport = openSeadragon.viewport.imageToViewportCoordinates(
          dotX,
          dotY // Place dot a bit lower so it's inside the hole
        );
        
        openSeadragon.viewport.viewer.addOverlay(noteDot, dotViewport, OpenSeadragon.Placement.CENTER);

        if (holeOverlays[event.tick] === undefined) {
          holeOverlays[event.tick] = [noteDot];
        } else {
          holeOverlays[event.tick].push(noteDot);
        }
      }

      if (event.track <= 3) {
        let noteVelocity = playComputedExpressions ? event.velocity : DEFAULT_NOTE_VELOCITY;

        let updatedVolume = (noteVelocity / 128.0) * volumeRatio;
        if (softPedalOn) {
          if (pedalTempoModOn) {
            updatedVolume *= SOFT_PEDAL_RATIO + ((1 - SOFT_PEDAL_RATIO) * pedalTempoModDelta);
          } else {
            updatedVolume *= SOFT_PEDAL_RATIO;
          }
        }
        if (parseInt(noteNumber) < panBoundary) {
          updatedVolume *= leftVolumeRatio;
        } else if (parseInt(noteNumber) >= panBoundary) {
          updatedVolume *= rightVolumeRatio;
        }
        //console.log("ON", getNoteName(noteNumber), noteVelocity);
        startNote(noteNumber, updatedVolume);

        if (!activeNotes.includes(noteNumber)) {
          activeNotes.push(parseInt(noteNumber));
        }
      }
    }
  } else if (event.name === "Controller Change") {
    // Controller Change number=64 is a sustain pedal event;
    // 127 is down (on), 0 is up (off)
    if (event.number == 64 && !sustainPedalLocked && useRollPedaling) {
      if (event.value == 127) {
        pressSustainPedal();
      } else if (event.value == 0) {
        releaseSustainPedal();
      }
      // 67 is the soft (una corda) pedal
    } else if (event.number == 67 && !softPedalLocked && useRollPedaling) {
      if (event.value == 127) {
        //console.log("SOFT ON");
        softPedalOn = true;
        document.getElementById("softPedal").classList.add("pressed");
      } else if (event.value == 0) {
        //console.log("SOFT OFF");
        softPedalOn = false;
        document.getElementById("softPedal").classList.remove("pressed");
      }
    } else if (event.number == 10) {
      // Controller Change number=10 sets the "panning position",
      // which is supposed to divide the keyboard into portions,
      // presumably bass and treble. These values are a bit odd
      // however and it's not clear how to use them, e.g.,
      // track 2: value = 52, track 3: value = 76
      //panBoundary = event.value;
    }
  } else if (event.name === "Set Tempo") {
    midiTempo = parseFloat(event.data);
    if (useMidiTempos) {
      applyTempoChange(midiTempo);
    } /*else {
      applyTempoChange(baseTempo);
    }*/
  }

  // The scrollTimer should ensure that the roll is synchronized with
  // playback; syncing at every note effect also can cause problems
  // on certain browsers if the playback events start to lag behind
  // their scheduled times.
  //panViewportToTick(event.tick);

  currentTick = event.tick;
  if (!showRoll) {
    updateProgress();
  }

};

const applyTempoChange = function(inputTempo) {
  tempoRatio =
    1.0 +
    (inputTempo - baseTempo) / baseTempo;
  playbackTempo = sliderTempo * tempoRatio;

  //console.log("BASE TEMPO",baseTempo,"INPUT TEMPO",inputTempo,"TEMPO RATIO IS",tempoRatio,"SLIDER TEMPO",sliderTempo,"SETTING PLAYBACK TEMPO TO", playbackTempo);

  if (scorePlayer && scorePlaying) {
    scorePlayer.pause();
    scorePlayer.setTempo(playbackTempo);
    scorePlayer.play();
  }

  if (samplePlayer.isPlaying()) {
    samplePlayer.pause();
    samplePlayer.setTempo(playbackTempo);
    samplePlayer.play();
  } else {
    samplePlayer.setTempo(playbackTempo);
  }

}

const toggleMidiTempos = function(event) {
  useMidiTempos = event.target.checked;
  if (!useMidiTempos) {
    // XXX This only works as long as the only the
    // tempo changes are always on track 1
    samplePlayer.disableTrack(1);
    applyTempoChange(baseTempo);
  } else {
    samplePlayer.enableTrack(1);
    const thisTick = samplePlayer.getCurrentTick();
    midiTempo = tempoMap.search(thisTick, thisTick)[0];
    applyTempoChange(midiTempo);
  }
}

const playPausePlayback = function () {
  if (scorePlaying) {
    return;
  }

  if (samplePlayer.isPlaying()) {
    // Pause
    samplePlayer.pause();
    clearScrollTimer();
    playState = "paused";
  } else {
    // Play
    if (showRoll) {
      openSeadragon.viewport.zoomTo(HOME_ZOOM);
    }
    activeNotes.forEach((noteNumber) => {
      keyboardToggleKey(noteNumber, false);
    });
    activeNotes = [];
    playState = "playing";
    
    // If we want this behavior (not panning back to the beginning
    // after a stop until the Play button is pressed), note that it
    // may be the case that sometimes the first note or two is lost
    // during the scrollback. The foolproof solution would be to
    // use an event listener to wait until the scroll is completed
    // before starting playback, but maybe it's not necessary...
    panViewportToTick(0);

    scrollTimer = setInterval(playerProgress, UPDATE_INTERVAL_MS);
    samplePlayer.play();
  }
};

const stopPlayback = function () {
  if (samplePlayer.isPlaying() || playState === "paused") {
    samplePlayer.stop();
    clearScrollTimer();
    activeNotes.forEach((noteNumber) => {
      keyboardToggleKey(noteNumber, false);
    });
    playState = "stopped";
    activeNotes = [];
    releaseSustainPedal();
    softPedalOn = false;
    document.getElementById("softPedal").classList.remove("pressed");
  }
};

const playerProgress = function () {
  if (samplePlayer && samplePlayer.isPlaying()) {
    currentTick = samplePlayer.getCurrentTick();
    if (showRoll) {
      panViewportToTick(currentTick);
      return;
    }
  } else if (scorePlayer && scorePlaying) {
    currentTick = scorePlayer.getCurrentTick();
  }
  updateProgress();
}

const updateProgress = function () {
  if (totalTicks > 0) {
    currentProgress = Math.min(
      1.0,
      parseFloat(currentTick) / parseFloat(totalTicks)
    );
  }

  document.getElementById("progressSlider").value = currentProgress;
  document.getElementById("progressPct").innerText =
    (currentProgress * 100.0).toFixed(2) + "%";
};

const skipTo = function (targetTick, targetProgress) {
  if (!(samplePlayer || scorePlayer)) {
    return;
  }

  currentTick = Math.max(0, targetTick);
  let playProgress = Math.max(0, targetProgress);

  if (useMidiTempos) {
    const currentTempo = tempoMap.search(currentTick, currentTick)[0];
    applyTempoChange(currentTempo);
  }

  if (scorePlayer && scorePlaying) {
    scorePlayer.pause();
    scorePlayer.skipToTick(currentTick);
    activeNotes.forEach((noteNumber) => {
      keyboardToggleKey(noteNumber, false);
    });
    activeNotes = [];
    currentProgress = playProgress;
    scorePlayer.play();
    scrollTimer = setInterval(playerProgress, UPDATE_INTERVAL_MS);
    updateProgress();

    return;
  }

  const pedalsOn = pedalMap.search(currentTick, currentTick);

  sustainPedalOn = sustainPedalLocked || pedalsOn.includes("sustain");
  softPedalOn = softPedalLocked || pedalsOn.includes("soft");

  if (samplePlayer.isPlaying()) {
    samplePlayer.pause();
    samplePlayer.skipToTick(currentTick);
    activeNotes.forEach((noteNumber) => {
      keyboardToggleKey(noteNumber, false);
    });
    activeNotes = [];
    currentProgress = playProgress;
    samplePlayer.play();
  } else {
    samplePlayer.skipToTick(currentTick);
  }
  updateProgress();
};

const skipToPixel = function (yPixel) {
  if (scorePlaying) {
    return;
  }

  let targetTick = yPixel - firstHolePx;
  if (scrollUp) {
    targetTick = firstHolePx - yPixel;
  }

  const targetProgress = parseFloat(targetTick) / parseFloat(totalTicks);

  skipTo(targetTick, targetProgress);
};

const skipToProgress = function (event) {
  const targetProgress = event.target.value;

  const targetTick = parseInt(
    parseFloat(targetProgress) * parseFloat(totalTicks)
  );

  skipTo(targetTick, targetProgress);
  panViewportToTick(targetTick);
};

const panViewportToTick = function (tick) {
  /* PAN VIEWPORT IMAGE */

  if (!showRoll) {
    return;
  }

  // If this is fired from the scrollTimer event (quite likely) the tick
  // argument will be undefined, so we get it from the player itself.
  if (typeof tick === "undefined" || isNaN(tick) || tick === null) {
    tick = samplePlayer.getCurrentTick();
  }

  let viewportBounds = openSeadragon.viewport.getBounds();

  // Thanks to Craig, MIDI tick numbers correspond to pixels from the first
  // hole of the roll.

  let linePx = firstHolePx + tick;
  if (scrollUp) {
    linePx = firstHolePx - tick;
  }

  let lineViewport = openSeadragon.viewport.imageToViewportCoordinates(
    0,
    linePx
  );

  let lineCenter = new OpenSeadragon.Point(
    viewportBounds.width / 2.0,
    lineViewport.y
  );

  let targetProgress = parseFloat(tick) / parseFloat(totalTicks);
  let playProgress = Math.max(0, targetProgress);
  currentTick = Math.max(0, tick);

  currentProgress = playProgress;

  updateProgress();

  openSeadragon.viewport.panTo(lineCenter);

};

const pressSustainPedal = function (pedalInput) {
  if (pedalInput !== undefined) {
    if (!(pedalInput instanceof KeyboardEvent)) {
      sustainLevel = parseInt(pedalInput);
    } else {
      if (pedalInput.type == "keydown") {
        if (pedalInput.code == SUSTAIN_LESS_KEY) {
          if (pedalInput.shiftKey) {
            sustainLevel = Math.max(0, sustainLevel - 1);
          } else {
            sustainLevel = Math.max(0, sustainLevel - SUSTAIN_LEVEL_DELTA);
          }
        } else if (pedalInput.code == SUSTAIN_MORE_KEY) {
          if (pedalInput.shiftKey) {
            sustainLevel = Math.min(127, sustainLevel + 1);
          } else {
            sustainLevel = Math.min(127, sustainLevel + SUSTAIN_LEVEL_DELTA);
          }
        }
      }
    }

    if (sustainLevel == 0) {
      releaseSustainPedal();
      return;
    } else {
      document.getElementById("sustainLevel").value = sustainLevel;
      document.getElementById("sustainLevelSlider").value = sustainLevel;
    }
  }
  
  // XXX how to accommodate changes in pedaling levels between on and off?
  //if (sustainPedalOn) {
  //  releaseSustainPedal();
  //}
  //console.log("SUSTAIN ON");
  if (!sustainPedalOn) {
    //piano.pedalDown();
    const sustainRatio = parseFloat(parseFloat(sustainLevel) / 127.0);
    console.log("SUSTAIN PEDAL GOING DOWN, LEVEL IS",sustainLevel,"RATIO",sustainRatio);
    //piano.pedalDown(sustainRatio);
    piano.pedalDown({ level: sustainRatio });
  }
  sustainPedalOn = true;
  document.getElementById("sustainPedal").classList.add("pressed");
};

const releaseSustainPedal = function () {
  piano.pedalUp();
  sustainPedalOn = false;
  //console.log("SUSTAIN OFF");
  document.getElementById("sustainPedal").classList.remove("pressed");
};

function togglePedalLock(event) {
  const pedalName = event.target.name;
  if (pedalName === "sustain") {
    if (sustainPedalLocked) {
      // Release sustained notes
      sustainPedalLocked = false;
      releaseSustainPedal();
    } else {
      sustainPedalLocked = true;
      pressSustainPedal();
    }
  } else if (pedalName === "soft") {
    softPedalLocked = !softPedalLocked;
    softPedalOn = softPedalLocked;
    if (softPedalOn) {
      //console.log("SOFT ON");
      document.getElementById("softPedal").classList.add("pressed");
    } else {
      //console.log("SOFT OFF");
      document.getElementById("softPedal").classList.remove("pressed");
    }
  }
}

const keyboardToggleKey = function (noteNumber, onIfTrue) {
  let keyElt = document.querySelector(
    'div[data-key="' + (parseInt(noteNumber) - 20).toString() + '"]'
  );
  if (keyElt === null) {
    console.log("TRIED TO (UN)HIGHLIGHT NONEXISTENT KEY:", noteNumber);
    return;
  }
  if (onIfTrue && !keyElt.classList.contains("piano-keyboard-key-active")) {
    keyElt.classList.add("piano-keyboard-key-active");
  } else if (
    !onIfTrue &&
    keyElt.classList.contains("piano-keyboard-key-active")
  ) {
    keyElt.classList.remove("piano-keyboard-key-active");
  }
};

// This is for playing notes manually pressed (clicked) on the keyboard
const midiNotePlayer = function (noteNumber, onIfTrue, velocity) {
  if (!velocity) {
    velocity = DEFAULT_NOTE_VELOCITY;
  }
  if (onIfTrue) {
    let updatedVolume = (velocity / 128.0) * volumeRatio;
    if (softPedalOn) {
      if (pedalTempoModOn) {
        updatedVolume *= SOFT_PEDAL_RATIO + ((1 - SOFT_PEDAL_RATIO) * PEDAL_TEMPO_MOD_DELTA);
      } else {
        updatedVolume *= SOFT_PEDAL_RATIO;
      }
    }
    if (parseInt(noteNumber) < HALF_BOUNDARY) {
      updatedVolume *= leftVolumeRatio;
    } else if (parseInt(noteNumber) >= HALF_BOUNDARY) {
      updatedVolume *= rightVolumeRatio;
    }
    startNote(noteNumber, updatedVolume);
  } else {
    stopNote(noteNumber);
  }
};

const updateTempoSlider = function (event) {

  if (event.type == "change") {
    sliderTempo = event.target.value;  
  } else if (event.type == "keydown") {
    if (event.code == TEMPO_FASTER_KEY) {
      sliderTempo = Math.min(180, sliderTempo + (TEMPO_KEY_DELTA * pedalTempoModDelta));
    } else if (event.code == TEMPO_SLOWER_KEY) {
      sliderTempo = Math.max(0, sliderTempo - (TEMPO_KEY_DELTA * pedalTempoModDelta));
    }
    document.getElementById("tempoSlider").value = sliderTempo;
  } else {
    return;
  }

  document.getElementById("tempo").value = sliderTempo + ' "bpm"';

  playbackTempo = sliderTempo * tempoRatio;

  if (scorePlayer && scorePlaying) {
    scorePlayer.pause();
    scorePlayer.setTempo(playbackTempo);
    scorePlayer.play();
  }

  // If not paused during tempo change, player jumps back a bit on
  // shift to slower playback tempo, forward on shift to faster tempo.
  // So we pause it.

  if (samplePlayer.isPlaying()) {
    samplePlayer.pause();
    samplePlayer.setTempo(playbackTempo);
    samplePlayer.play();
  } else {
    samplePlayer.setTempo(playbackTempo);
  }

};

const updateVolumeSlider = function (event) {

  let sliderName = "volume";

  // At present, only the main volume is key-mapped
  if (event.type == "keydown") {
    if (event.code == VOLUME_UP_KEY) {
      volumeRatio = Math.min(4, volumeRatio + (VOLUME_KEY_DELTA * volAccentModDelta));
    } else if (event.code == VOLUME_DOWN_KEY) {
      volumeRatio = Math.max(0, volumeRatio - (VOLUME_KEY_DELTA * volAccentModDelta));
    }
    volumeRatio = Math.round(10*volumeRatio)/10; 
    document.getElementById("masterVolume").value = volumeRatio;
    document.getElementById("masterVolumeSlider").value = volumeRatio;
  } else {
    sliderName = event.target.name;

    if (sliderName === "volume") {
      volumeRatio = event.target.value;
      document.getElementById("masterVolume").value = volumeRatio;
    } else if (sliderName === "leftVolume") {
      leftVolumeRatio = event.target.value;
      document.getElementById("leftVolume").value = leftVolumeRatio;
    } else if (sliderName === "rightVolume") {
      rightVolumeRatio = event.target.value;
      document.getElementById("rightVolume").value = rightVolumeRatio;
    }
  }
};

const updateSustainLevel = function (event) {
  sustainLevel = event.target.value;
  document.getElementById("sustainLevel").value = sustainLevel;
}

// XXX Ugh manual styling -- just for prototyping
const toggleAccent = function (event) {
  switch(event.type) {
    case "mousedown":
      accentOn = true;
      document.getElementById("accentButton").style.backgroundColor = "red";
      break;
    case "mouseover":
      document.getElementById("accentButton").style.backgroundColor = "cornflowerblue";
      break;
    case "mouseup":
      accentOn = false;
      document.getElementById("accentButton").style.backgroundColor = "cornflowerblue";
      break;
    case "mouseout":
      accentOn = false;
      document.getElementById("accentButton").style.backgroundColor = "white";
      break;
    case "keydown":
      accentOn = true;
      document.getElementById("accentButton").style.backgroundColor = "red";
      break;
    case "keyup":
      accentOn = false;
      document.getElementById("accentButton").style.backgroundColor = "white";
      break;
  }
}

const toggleExpressions = function (event) {
  playComputedExpressions = event.target.checked;
};

const toggleRollPedaling = function (event) {
  useRollPedaling = event.target.checked;
  if (!useRollPedaling) {
    releaseSustainPedal();
    softPedalOn = false;
    document.getElementById("softPedal").classList.remove("pressed");
  }
}

const toggleRoll = function (event) {
  showRoll = event.target.checked;
  if (showRoll) {
    samplePlayer.stop();
    samplePlayer = null;
    let osdLair = document.createElement("div");
    osdLair.setAttribute("name", "osdLair");
    osdLair.classList.add("osdLair");
    document.getElementById("osdWrapper").appendChild(osdLair);
    initOSD();
    initPlayer();
  } else {
    openSeadragon.close();
    openSeadragon = null;
    document.getElementById("osdWrapper").children[0].remove();
  }
}

const clearScrollTimer = function () {
  if (scrollTimer) {
    clearInterval(scrollTimer);
    scrollTimer = null;
  }
}

const toggleScore = function (event) {
  showScore = event.target.checked;
  if (showScore) {
    document.getElementById("scoreWrapper").appendChild(scoreStorage);
    initScorePlayer();
  } else {
    if (scorePlayer) {
      if (scorePlaying) {
        scorePlayer.stop();
        scorePlaying = false;
        clearScrollTimer();
      }
    }
    let scoreNode = document.getElementById("scoreWrapper").children[0];
    if (scoreNode) {
      scoreStorage = scoreNode.cloneNode(true);
      scoreNode.remove();
    }
    scorePlayer = null;
  }
}

const scorePlayback = function (e) {
  if (scorePlayer === null) {
    return;
  }

  if (
    e.target.name === "playScore" &&
    !scorePlaying &&
    !samplePlayer.isPlaying() &&
    playState !== "paused"
  ) {
    activeNotes.forEach((noteNumber) => {
      keyboardToggleKey(noteNumber, false);
    });
    scorePlaying = true;
    currentScorePage = 1;
    document.getElementById("scorePage").innerHTML =
      scorePages[currentScorePage - 1];
    activeNotes = [];
    totalTicks = scorePlayer.totalTicks;
    scrollTimer = setInterval(playerProgress, UPDATE_INTERVAL_MS);
    scorePlayer.play();
  } else if (e.target.name === "stopScore" && scorePlaying) {
    scorePlaying = false;
    scorePlayer.stop();
    clearScrollTimer();

    activeNotes.forEach((noteNumber) => {
      keyboardToggleKey(noteNumber, false);
    });

    activeNotes = [];
    currentProgress = 0;
    releaseSustainPedal();
    softPedalOn = false;
    document.getElementById("softPedal").classList.remove("pressed");

    if (highlightedNotes && highlightedNotes.length > 0) {
      highlightedNotes.forEach((noteId) => {
        let noteElt = document.getElementById(noteId);
        if (noteElt) {
          noteElt.setAttribute("style", "fill: #000");
        }
      });
    }

    highlightedNotes = [];

    //totalTicks = samplePlayer.totalTicks;
  }
};

const changeScorePage = function (e) {
  if (!scorePlayer || scorePlaying) {
    return;
  }
  if (e.target.name == "prevPage" && currentScorePage > 1) {
    currentScorePage--;
    document.getElementById("scorePage").innerHTML =
      scorePages[currentScorePage - 1];
  } else if (
    e.target.name == "nextPage" &&
    currentScorePage < scorePages.length
  ) {
    currentScorePage++;
    document.getElementById("scorePage").innerHTML =
      scorePages[currentScorePage - 1];
  }
};

const getNoteName = function (noteNumber) {
  const octave = parseInt(noteNumber / 12) - 1;
  noteNumber -= 21;
  const name = SHARP_NOTES[noteNumber % 12];
  return name + octave;
};

const getMidiNumber = function (noteName) {
  let note = "";
  let octave = 0;
  for (let i = 0; i < noteName.length; i++) {
    let c = noteName.charAt(i);
    if (c >= "0" && c <= "9") {
      octave = parseInt(c);
    } else {
      note += c;
    }
  }
  let noteNumber = NaN;
  if (SHARP_NOTES.includes(note)) {
    noteNumber = (octave - 1) * 12 + SHARP_NOTES.indexOf(note) + 21;
  } else if (FLAT_NOTES.includes(note)) {
    noteNumber = (octave - 1) * 12 + FLAT_NOTES.indexOf(note) + 21;
  }
  return noteNumber;
};

const initOSD = function() {

  if (!showRoll) {
    if (document.getElementById("osdWrapper").hasChildNodes()) {
      document.getElementById("osdWrapper").children[0].remove();
    }
    return;
  }

  document.getElementsByName("osdLair")[0].id = viewerId;

  openSeadragon = new OpenSeadragon({
    id: viewerId,
    showNavigationControl: false,
    panHorizontal: false,
    visibilityRatio: 1,
    defaultZoomLevel: HOME_ZOOM,
    minZoomLevel: 0.01,
    maxZoomLevel: 4,
  });

  openSeadragon.addHandler("canvas-drag", () => {
    let center = openSeadragon.viewport.getCenter();
    let centerCoords = openSeadragon.viewport.viewportToImageCoordinates(center);
    skipToPixel(centerCoords.y);
  });

}

/* INIT */

initOSD();

//let globalPiano = null;

// create the piano and load velocity steps
let piano = new Piano({
  // XXX The samples load from the guy's Github site
  // unless there's a valid URL, and using a
  // local folder seems problematic...
  url: BASE_DATA_URL + 'audio/mp3/', // works if avaialable
  //url: '/audio/', // note sure we want to try to bundle these...
  velocities: DEFAULT_VELOCITIES,
  release: true,
  pedal: true,
  maxPolyphony: 64,
}).toDestination();

let loadPiano = piano.load();
Promise.all([loadPiano]).then(() => {
  console.log("Piano loaded");
  document.getElementById("playPause").disabled = false;
  //document.getElementById("playScorePage").disabled = false;
  //globalPiano = piano;
});

let keyboard_elt = document.querySelector(".keyboard");

keyboard = new Keyboard({
  element: keyboard_elt,
  range: ["a0", "c8"],
  a11y: false,
});

keyboard
  .on("noteOn", function ({ which, volume, target }) {
    midiNotePlayer(which + 20, true);
  })
  .on("noteOff", function ({ which, volume, target }) {
    midiNotePlayer(which + 20, false);
  });

/*

document.querySelectorAll("input.samplevol").forEach((input) => {
  piano[input.name].value = parseInt(input.value, 10);
  document.getElementById(input.name).value = parseInt(input.value, 10);
  input.addEventListener("input", (e) => {
    document.getElementById(e.target.name).value = parseInt(e.target.value, 10);
    piano[e.target.name].value = parseInt(e.target.value, 10);
  });
});

document.getElementById("velocities").value = document.getElementById("velocitiesSlider").value;

document.getElementById("velocitiesSlider").addEventListener("input", (e) => {
  document.getElementById("velocities").value = document.getElementById("velocitiesSlider").value;

  if (playState === "playing") {
    playPausePlayback();
  }

  document.getElementById("playPause").disabled = true;
  document.getElementById("playScorePage").disabled = true;
  document.getElementById("stop").disabled = true;
  document.getElementById("stopScorePage").disabled = true;
  globalPiano.dispose();

  piano = new Piano({
    // XXX The samples load from the guy's Github site
    // unless there's a valid URL, and using a
    // local folder seems problematic...
    url: BASE_DATA_URL + 'audio/mp3/', // works if avaialable
    //url: '/audio/', // note sure we want to try to bundle these...
    velocities: parseInt(e.target.value),
    release: true,
    pedal: true,
    maxPolyphony: 64,
  }).toDestination();

  let loadPiano = piano.load();
  Promise.all([loadPiano]).then(() => {
    console.log("Piano reloaded");

    document.querySelectorAll("input.samplevol").forEach((input) => {
      piano[input.name].value = parseInt(input.value, 10);
    });

    document.getElementById("playPause").disabled = false;
    document.getElementById("playScorePage").disabled = false;
    document.getElementById("stop").disabled = false;
    document.getElementById("stopScorePage").disabled = false;

    globalPiano = piano;
    if (playState === "paused") {
      playPausePlayback();
    }
  });

});

*/

let recordingsChooser = document.getElementById("recordings");
recordingsChooser.onchange = loadRecording;
for (const recId in recordings_data) {
  let opt = document.createElement("option");
  opt.value = recId;
  opt.text = recordings_data[recId]["title"];
  recordingsChooser.appendChild(opt);
}

let tempoSlider = document.getElementById("tempoSlider");
tempoSlider.value = sliderTempo;
tempoSlider.onchange = updateTempoSlider;

document.getElementById("masterVolumeSlider").value = volumeRatio;
document.getElementById("masterVolume").value = volumeRatio;
document.getElementById("leftVolumeSlider").value = leftVolumeRatio;
document.getElementById("leftVolume").value = leftVolumeRatio;
document.getElementById("rightVolumeSlider").value = rightVolumeRatio;
document.getElementById("rightVolume").value = rightVolumeRatio;

document.getElementById("sustainLevelSlider").value = sustainLevel;
document.getElementById("sustainLevel").value = sustainLevel;

verovio.module.onRuntimeInitialized = function () {
  ///create the toolkit instance
  vrvToolkit = new verovio.toolkit();

  loadRecording(null, currentRecordingId);
};

document.getElementById("masterVolumeSlider").onchange = updateVolumeSlider;
document.getElementById("leftVolumeSlider").onchange = updateVolumeSlider;
document.getElementById("rightVolumeSlider").onchange = updateVolumeSlider;

document.getElementById("sustainLevelSlider").onchange = updateSustainLevel;

document.getElementById("tempo").value = sliderTempo + ' "bpm"';

document
  .getElementById("playPause")
  .addEventListener("click", playPausePlayback, false);
document.getElementById("stop").addEventListener("click", stopPlayback, false);

document
  .getElementById("sustainPedal")
  .addEventListener("click", togglePedalLock, false);
document
  .getElementById("softPedal")
  .addEventListener("click", togglePedalLock, false);

document
  .getElementById("progressSlider")
  .addEventListener("input", skipToProgress, false);

document
  .getElementById("prevScorePage")
  .addEventListener("click", changeScorePage, false);
document
  .getElementById("nextScorePage")
  .addEventListener("click", changeScorePage, false);

document
  .getElementById("playScorePage")
  .addEventListener("click", scorePlayback, false);
document
  .getElementById("stopScorePage")
  .addEventListener("click", scorePlayback, false);

document
  .getElementById("playExpressions")
  .addEventListener("click", toggleExpressions, false);

document
  .getElementById("useRollPedaling")
  .addEventListener("click", toggleRollPedaling, false);

document
  .getElementById("useMidiTempos")
  .addEventListener("click", toggleMidiTempos, false);

document
  .getElementById("accentButton")
  .addEventListener("mousedown", toggleAccent, false);

document
  .getElementById("accentButton")
  .addEventListener("mouseup", toggleAccent, false);

document
  .getElementById("accentButton")
  .addEventListener("mouseover", toggleAccent, false)

document
  .getElementById("accentButton")
  .addEventListener("mouseout", toggleAccent, false)

document
  .getElementById("showRoll")
  .addEventListener("click", toggleRoll, false);

document
  .getElementById("showScore")
  .addEventListener("click", toggleScore, false);

// Keyboard events!
const keyboardKeyControl = function(event) {
  switch(event.code) {
    case PEDAL_TEMPO_MODIFY_KEY:
      if (event.type == "keydown") {
        pedalTempoModOn = true;
        pedalTempoModDelta = PEDAL_TEMPO_MOD_DELTA;
      } else if (event.type == "keyup") {
        pedalTempoModOn = false;
        pedalTempoModDelta = 1;
      }
      break;
    case VOL_ACCENT_MODIFY_KEY:
      if (event.type == "keydown") {
        volAccentModDelta = VOL_ACCENT_MOD_DELTA;
      } else if (event.type == "keyup") {
        volAccentModDelta = 1;
      }
      break;
    case SUSTAIN_PEDAL_KEY:
      if (event.type == "keydown") {
        if (sustainPedalOn) {
          break;
        }
        pressSustainPedal();
        break;
      } else if (event.type == "keyup") {
        if (!sustainPedalOn) {
          break;
        }
        releaseSustainPedal();
      }
      break;
    case SOFT_PEDAL_KEY:
      if (event.type == "keydown") {
        if (softPedalOn) {
          break;
        }
        softPedalOn = true;
        document.getElementById("softPedal").classList.add("pressed");
      } else {
        if (!softPedalOn) {
          break;
        }
        softPedalOn = false;
        document.getElementById("softPedal").classList.remove("pressed");
      }
      break;
    case TEMPO_FASTER_KEY:
      updateTempoSlider(event);
      break;
    case TEMPO_SLOWER_KEY:
      updateTempoSlider(event);
      break;
    case VOLUME_UP_KEY:
      updateVolumeSlider(event);
      break;
    case VOLUME_DOWN_KEY:
      updateVolumeSlider(event);
      break;
    case ACCENT_KEY:
      toggleAccent(event);
      break;
    case SUSTAIN_MORE_KEY:
      pressSustainPedal(event);
      break;
    case SUSTAIN_LESS_KEY:
      pressSustainPedal(event);
      break;
  }
}

window.addEventListener("keydown", function(event) {
  keyboardKeyControl(event);
}, true);

window.addEventListener("keyup", function(event) {
  keyboardKeyControl(event);
}, true);

// Check for Web MIDI support, because why not
if (navigator.requestMIDIAccess) {
  console.log('This browser supports WebMIDI!');
  navigator.requestMIDIAccess()
    .then(function(access) {

      // Get lists of available MIDI controllers
      //const inputs = access.inputs.values();
      //const outputs = access.outputs.values();

      Array.from(access.inputs).forEach(input => {
        input[1].onmidimessage = (msg) => {
          if (msg.data.length > 1) {
            // 176 probably = control change; 64 = sustain pedal
            // SUSTAIN PEDAL MSGS ARE 176, 64, 0-127
            // KEYPRESS MSGS ARE 144, [MIDI_NUMBER], 0-100?
            if ((msg.data[0] == 176) && (msg.data[1] == 64)) {
              pressSustainPedal(parseInt(msg.data[2]));
            } else if (msg.data[0] == 144) {
              if (msg.data[2] == 0) {
                midiNotePlayer(msg.data[1], false);
              } else {
                midiNotePlayer(msg.data[1], true, msg.data[2]);
              }            
            }
          }
        }
      })

      access.onstatechange = function(e) {
        // Print information about the (dis)connected MIDI controller
        console.log(e.port.name, e.port.manufacturer, e.port.state);
      };
    });
} else {
  console.log('WebMIDI is not supported in this browser.');
}

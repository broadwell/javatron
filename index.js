import MidiPlayer from "midi-player-js"; // Decodes and plays back MIDI data
import OpenSeadragon from "openseadragon";
import IntervalTree from "node-interval-tree";
import verovio from "verovio";
import { v4 as uuidv4 } from "uuid";
import Keyboard from "piano-keyboard";
import { Piano } from "@tonejs/piano";
import Bunzip from "seek-bzip";
import { Buffer } from "buffer";
import ATON from "aton";

import Chart from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
Chart.plugins.register(zoomPlugin);

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
const DEFAULT_NOTE_VELOCITY = 33; // Only applies to manual keypresses and non-expression rolls
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
const WELTE_MIDI_START = 10; // TRACKER_HOLE 1 = MIDI 11
const WELTE_RED_FIRST_NOTE = 24;
const WELTE_RED_LAST_NOTE = 103;
const WELTE_RED_NOTES_START = 11; // For overlays from MIDI numbers alone
const POPULAR_MIDI_START = 16; // TRACKER_HOLE 1 = MIDI 16
const POPULAR_NOTES_START = 5; // For overlays from MIDI numbers alone
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
let notesMap = null;
let pedalSeries = null;
let playComputedExpressions = true;
let useRollPedaling = true;
let accentOn = false;
let pedalTempoModOn = false;
let volAccentModDelta = 1;
let pedalTempoModDelta = 1;
let useMidiTempos = true;

let pedalsChart = null;

let midiOut = null; // MIDI output device (should be at most one)
const MIDI_NOTE_ON = 0x90; // = the event code (0x90) + channel (0)
const MIDI_NOTE_OFF = 0x80; // = the event code (0x80) + channel (0) is the event code + 
const MIDI_CONTROL = 0xB0;
const MIDI_SUSTAIN = 0x40;
const MIDI_SOFT = 0x43;

let showRoll = false;
let openSeadragon = null;
let firstHolePx = 0;
let scrollTimer = null;
let viewerId = uuidv4();
let overlayPersist = 100; // # ticks = pixels on original roll image
let holeOverlays = {}; // value = div, key is offtime
let holeWidth = 0;
let holeSep = 0;
let holesInfo = {}; // Hole data, indexed by start tick (not pixel)
let paintHoles = false; // Whether to draw in entire hole lane on roll
let paintedHoles = {}; // key = ID, value = offtime tick
let horizPos = 0.5; // Hack to keep track of horizontal pan position of viewer
let activeOnly = true; // When false, overlay all holes in viewer
let blankRoll = false; // Hides roll image, so only overlays are visible

/* Defaults for time-based acceleration emulation */
let rollPPI = 300.0;
let timeQuantumInTicks = 12.0 * rollPPI;
let accelRate = .0022;

let showScore = false;
let noScore = true;
let scoreStorage = null;
let recordingSlug = null;
let scorePages = [];
let currentScorePage = 1;
let currentRecordingId = Object.keys(recordings_data)[0];
let vrvToolkit = null;

let scrollUp = false;

let keyboard = null;

const startNote = function (noteNumber, volume) {

  if (accentOn) {
    volume = volume * (ACCENT_BUMP * volAccentModDelta);
  }

  volume = Math.min(volume, 1.0);

  let noteVelocity = Math.round(127.0 * volume);

  if (noteVelocity > 0) {
    piano.keyDown({ midi: noteNumber, velocity: volume });
    if (midiOut) {
      midiOut.send([MIDI_NOTE_ON, noteNumber, noteVelocity]);
    }
  }
  keyboardToggleKey(noteNumber, true);
};

const stopNote = function (noteNumber) {
  piano.keyUp({ midi: noteNumber });
  keyboardToggleKey(noteNumber, false);
  if (midiOut) {
    midiOut.send([MIDI_NOTE_OFF, noteNumber, 0]);
  }
};

const initScoreViewer = function () {

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
    document.getElementById("scoreWrapper").hidden = true;
    return;
  }

  /* load the MEI data as a string into the toolkit */

  if (showScore && !noScore) {

    if (scoreStorage) {
      document.getElementById("scoreWrapper").hidden = false;
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
    if (showRoll) {
      clearOverlaysBeforeTick(samplePlayer.getCurrentTick(), true);
    }
  }
  clearScrollTimer();
  activeNotes.forEach((noteNumber) => {
    stopNote(noteNumber);
  });
  activeNotes = [];
  releaseSustainPedal();
  releaseSoftPedal();

  console.log("loading recording ID", currentRecordingId);

  document.getElementById("recordings").value = currentRecordingId;

  recordingSlug = recordings_data[currentRecordingId]["slug"];
  //currentRecording = midiData[recordingSlug];

  if (showRoll) {
    clearOverlaysBeforeTick(0, true);
  }
  activeOnly = true;
  document.getElementById("activeOnly").checked = true;
  blankRoll = false;
  document.getElementById("blankRoll").checked = false;

  initPlayer();

  initScoreViewer();

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
    holesInfo = {};
    rollMetadata = {};
    const metadataRegex = /^@(?<key>[^:]*):[\t\s]*(?<value>.*)$/;
    let tempoChanges = [];

    pedalMap = new IntervalTree();
    notesMap = {"open": {}}
    pedalSeries = {labels: [0], datasets: [{label: "Sustain", data: [0], borderColor: "red", fill: false},
                                          {label: "Soft", data: [0], borderColor: "blue", fill: false}
                                         ]};

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
            if (!pedalSeries.labels.includes(event.tick)) {
              for (let i=pedalSeries.labels[pedalSeries.labels.length-1]+1; i<=event.tick; i += 100) {
                pedalSeries.labels.push(i);
                pedalSeries.datasets[0].data.push(sustainOn ? 1 : 0);
                pedalSeries.datasets[1].data.push(softOn ? 1 : 0);
              }
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
            if (!pedalSeries.labels.includes(event.tick)) {
              for (let i=pedalSeries.labels[pedalSeries.labels.length-1]+1; i<=event.tick; i+= 100) {
                pedalSeries.labels.push(i);
                pedalSeries.datasets[0].data.push(sustainOn ? 1 : 0);
                pedalSeries.datasets[1].data.push(softOn ? 1 : 0);
              }
            }
          }
        } else if (event.name === "Set Tempo") {
          tempoChanges.push([parseInt(event.tick), parseFloat(event.data)]);
        } else if (event.name === "Text Event") {
          let text = decodeCharRefs(event.string);
          if (!text) return;
          const found = text.match(metadataRegex);
          rollMetadata[found.groups.key] = found.groups.value;
        } else if (event.name === "Note on") {
          if (event.track > 3) {
            // XXX May eventually process control events here too
            return;
          }
          const noteNumber = event.noteNumber;
          if ((event.velocity == 0) && (notesMap["open"][noteNumber] !== undefined)) {
            const startTick = notesMap["open"][noteNumber];
            if (notesMap[startTick] === undefined) {
              notesMap[startTick] = {};
              notesMap[startTick][noteNumber] = event.tick;
            } else {
              notesMap[startTick][noteNumber] = event.tick;
            }
            delete notesMap["open"][noteNumber];
          }
          if ((event.velocity > 0) && (notesMap["open"][noteNumber] === undefined)) {
            notesMap["open"][noteNumber] = event.tick;
          }
        }
      });
    });

    totalTicks = samplePlayer.totalTicks;

    //pedalSeries.push({x: totalTicks, sustain: 0, soft: 00});
    if (!pedalSeries.labels.includes(totalTicks)) {
      for (let i=pedalSeries.labels[pedalSeries.labels.length-1]+1; i<=totalTicks; i+=100) {
        pedalSeries.labels.push(i);
        pedalSeries.datasets[0].data.push(0);
        pedalSeries.datasets[1].data.push(0);
      }
    }
    console.log(pedalSeries);

    let sortedTempoChanges = tempoChanges.sort(function(a, b) {
      return a[0] - b[0];
    });

    tempoMap = new IntervalTree();

    //console.log("LENGTH-BASED ACCELERATION MAP (FROM MIDI FILE)");

    sortedTempoChanges.forEach((item, i) => {
      if (i == 0) {
        baseTempo = item[1];
      }

      if (i < sortedTempoChanges.length - 1) {
        tempoMap.insert(item[0], sortedTempoChanges[i+1][0] - 1, item[1]);
      } else {
        tempoMap.insert(item[0], totalTicks, item[1]);
      }
    });

    let timeTempoMap = new IntervalTree();

    // Use 'LENGTH_DPI' for the roll PPI? It's often given as 300.25ppi on the
    // roll metadata, but for now rollPPI is hardcoded at 300.
    if ('ACCEL_INCH' in rollMetadata) {
      timeQuantumInTicks = parseFloat(rollMetadata['ACCEL_INCH']) * rollPPI;
    }
    if ('ACCEL_PERCENT' in rollMetadata) {
      accelRate = parseFloat(rollMetadata['ACCEL_PERCENT']) / 100.0;
    }
    let accelFactor = 1.0;
    let thisTempo = baseTempo;
    let thisTime = 0.0;

    while (thisTime < totalTicks) {
      
      let nextTime = thisTime + Math.floor(timeQuantumInTicks * accelFactor);
      thisTempo = parseInt(baseTempo * accelFactor);

      if (nextTime > totalTicks) {
        nextTime = totalTicks + 1;
      }

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
    // document.getElementById('callno').innerText = rollMetadata['CALLNUM'];

    scrollUp = false;
    document.getElementById("playExpressions").disabled = false;
    document.getElementById("useRollPedaling").disabled = false;
    document.getElementById("activeOnly").disabled = false;
    document.getElementById("blankRoll").disabled = false;
    if (rollMetadata["ROLL_TYPE"] !== "welte-red") {
      scrollUp = true;
      document.getElementById("playExpressions").disabled = true;
      document.getElementById("useRollPedaling").disabled = true;
      document.getElementById("activeOnly").disabled = true;
      document.getElementById("blankRoll").disabled = true;
    }

    firstHolePx = parseInt(rollMetadata["FIRST_HOLE"]);
    if (scrollUp) {
      firstHolePx = parseInt(rollMetadata["IMAGE_LENGTH"]) - firstHolePx;
    }

    //let lastHolePx = parseInt(rollMetadata["LAST_HOLE"]);
    //let rollWidth = parseInt(rollMetadata["ROLL_WIDTH"]);

    holeWidth = parseFloat(rollMetadata['AVG_HOLE_WIDTH'].replace('px',''));

    holeSep = parseFloat(rollMetadata['HOLE_SEPARATION'].replace('px',''));

    updateProgress();

    if (showRoll) {
      
      openSeadragon.open(recordings_data[currentRecordingId]["image_url"]);
      //openSeadragon.viewport.viewer.addTiledImage({tileSource: recordings_data[currentRecordingId]["image_url"]});

      openSeadragon.addOnceHandler("update-viewport", () => {
        panViewportToTick(0);
      });
    }
    currentTick = 0;
    playerProgress();

    initPedalPlot();

  });

  samplePlayer.on("playing", () => {
    // Do something while player is playing
    // (this is repeatedly triggered within the play loop)
  });

  samplePlayer.on("midiEvent", midiEvent);

  samplePlayer.on("endOfFile", function () {
    console.log("END OF FILE");
    stopPlayback();
    // Do something when end of the file has been reached.
    horizPos = .5;
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
  
  fetch(BASE_DATA_URL + 'analyses/' + currentRecordingId + '_analysis.txt.bz2')
    .then(response => {
      if (!response.ok) {
        throw new Error('Network error');
      }
      return response.arrayBuffer();
    })
    .catch(error => {
      paintHoles = false;
      return null;
    })
    .then(data => {
      if (data) {
        processHoleAnalysis(data);
      }
    })

}

const initPedalPlot = function() {

  const cfg = {
    type: 'line',
    data: pedalSeries,
    options: {
      pointRadius: 1,
      pointStyle: 'circle',
      borderWidth: 1,
      legend: {
        display: false
      },
      responsive: true,
      spanGaps: true,
      title: {
        display: false,
        text: "Pedaling events"
      },
      scales: {
        yAxes: [{
          ticks: {
            display: false
          }
        }],
        xAxes: [{
          ticks: {
            display: false
          }
        }]
      },
      plugins: {
        zoom: {
          zoom: {
            enabled: true,
            mode: 'x',
          },
          pan: {
            enabled: true,
            mode: 'x',
          }
        }
      }
    }
  }

  pedalsChart = new Chart(document.getElementById('pedalsChart'), cfg);

  pedalsChart.setZoom = function(min, max) {
    console.log("setting X zoom to",min,max);
    console.log(pedalsChart.scales);
    let xScale = pedalsChart.scales['x-axis-0'];
    let tickOptions = xScale.options.ticks;
    if (tickOptions) {
      let labels = xScale.chart.data.labels;
      xScale.options.ticks.min = Math.max(min,0);
      xScale.options.ticks.max = max;
    }
    // helpers.each(chartInstance.data.datasets, function(dataset, id) {
		// 	dataset._meta = null;
		// });

    pedalsChart.update();
    console.log(pedalsChart);
  }

}

const processHoleAnalysis = function(data) {
  const output = Bunzip.decode(Buffer.from(data));
  const atonReader = new ATON();
  const analysis = atonReader.parse(output.toString());
  const holesData = analysis.ROLLINFO.HOLES.HOLE;
  paintHoles = true;

  holesData.forEach(hole => {

    // AREA: "1171px"
    // CENTROID_COL: "482.535px"
    // CENTROID_ROW: "13454.9px"
    // CIRCULARITY: "0.72"
    // HPIXCOR: "3.6px"
    // ID: "K0_N1"
    // MAJOR_AXIS: "0deg"
    // MIDI_KEY: "-1"
    // NOTE_ATTACK: "13426px"
    // OFF_TIME: "13483px"
    // ORIGIN_COL: "472px"
    // ORIGIN_ROW: "13426px"
    // PERIMETER: "142.512px"
    // TRACKER_HOLE: "13"
    // WIDTH_COL: "22px"
    // WIDTH_ROW: "57px"

    if (hole['NOTE_ATTACK'] === undefined) {
      // This happens rarely; not sure why
      return;
    }
    // XXX Assuming the roll type is known (and more importantly, the
    // number of control hole colums before the first note hole),
    // the TRACKER_HOLE value can be used to compute the MIDI number
    // and note name of each hole.
    const attack = parseInt(hole['NOTE_ATTACK'].replace('px', ''));
    let tick = attack - firstHolePx;
    if (scrollUp) {
      tick = firstHolePx - attack;
    }
    if (holesInfo[tick] === undefined) {
      holesInfo[tick] = [hole];
    } else {
      holesInfo[tick].push(hole);
    }
  });

}

const toggleActiveOnly = function(event) {
  activeOnly = event.target.checked;
  clearOverlaysBeforeTick(0,true);
  updateOverlays();
}

const toggleBlankRoll = function(event) {
  blankRoll = event.target.checked;
  if (blankRoll) {
    // This hides the roll image as "background"
    // (actually stops tiles from being loaded)
    openSeadragon.world.getItemAt(0).setOpacity(0);
  } else {
    openSeadragon.world.getItemAt(0).setOpacity(1);
  }
}

const updateOverlays = function(tick) {
  if (!showRoll || !paintHoles) {
    return;
  }

  if (tick === undefined) {
    tick = samplePlayer.getCurrentTick();
  }

  if (activeOnly || (!activeOnly && (openSeadragon.viewport.getZoom() < 1))) {
    clearOverlaysBeforeTick(tick);
    overlayHolesAtTick(tick);
  } else {
    clearOverlaysOutsideWindow();
    overlayHolesInWindow();
  }

}

// Note option to clear all holes
const clearOverlaysBeforeTick = function(newTick, allIfTrue) {

  if (!showRoll || !paintHoles) {
    return;
  }

  Object.keys(holeOverlays).forEach(tick => {
    if ((allIfTrue !== undefined) || (newTick > parseInt(tick))) {
      holeOverlays[tick].forEach(item => {
        openSeadragon.viewport.viewer.removeOverlay(item);
      });
      delete holeOverlays[tick];
    }
  });
  // We also keep track of the hole IDs of the currently drawn
  // holes, so we don't draw them twice when their start pixel
  // values coincide
  if (paintHoles) {
    Object.keys(paintedHoles).forEach(holeId => {
      if ((allIfTrue !== undefined) || (paintedHoles[holeId] <= newTick)) {
        delete paintedHoles[holeId];
      }
    });
  }

}

const clearOverlaysOutsideWindow = function() {

  if (!showRoll || !paintHoles) {
    return;
  }

  const [firstPx, lastPx] = getViewableY();

  let firstTick = firstPx - firstHolePx;
  let lastTick = lastPx - firstHolePx;
  if (scrollUp) {
    firstTick = firstHolePx - firstPx;
    lastTick = firstHolePx - lastPx;
  }

  // Delete all overlays that don't overlap with the current viewer window
  // XXX This only removes an overlay if its last tick is outside the window
  Object.keys(paintedHoles).forEach(holeId => {
    const holeOffTick = paintedHoles[holeId];
    if ((holeOffTick < firstTick) || (holeOffTick > lastTick)) {
      if (holeOffTick in holeOverlays) {
        holeOverlays[holeOffTick].forEach(item => {
          openSeadragon.viewport.viewer.removeOverlay(item);
        });
        delete holeOverlays[holeOffTick];
      }
      delete paintedHoles[holeId];
    }
  });

}

const overlayHolesAtTick = function (tick) {

  if (!showRoll || !paintHoles) {
    return;
  }

  if (holesInfo[tick] === undefined) {
    return;
  }

  //console.log("Drawing holes at tick",tick);

  holesInfo[tick].forEach(hole => {

    const holeId = hole['ID'];

    if (holeId in paintedHoles) {
      return;
    }

    const colWidth = parseInt(hole['WIDTH_COL'].replace('px', ''));
    const pointX = parseInt(hole['ORIGIN_COL'].replace('px', ''));
    // This should be == linePx
    const pointY = parseInt(hole['ORIGIN_ROW'].replace('px', ''));

    //const rowWidth = parseFloat(hole['WIDTH_ROW'].replace('px',''));
    const offPx = parseInt(hole['OFF_TIME'].replace('px', ''));
    let offTime = offPx - firstHolePx;
    let midiNumber = parseInt(hole['TRACKER_HOLE']) + WELTE_MIDI_START;
    if (scrollUp) {
      offTime = firstHolePx - offPx;
      midiNumber = parseInt(hole['TRACKER_HOLE']) - POPULAR_MIDI_START;
    }
    // Should be the same as lineTick - offTime
    const noteLength = offPx - pointY;

    let noteElt = document.createElement("div");
    // XXX Rolls often don't use top end of keyboard;
    // Need a constant value for these by roll type
    if ((midiNumber >= WELTE_RED_FIRST_NOTE) && (midiNumber <= WELTE_RED_LAST_NOTE)) {
      //console.log("NOTE",holeId,"TRACKER",hole['TRACKER_HOLE'],"DURATION",noteLength,"X",pointX,"Y",pointY);
      noteElt.title = getNoteName(midiNumber) + " " + midiNumber.toString() + " (" + holeId + ") tick " + tick;
      noteElt.classList.add('music-hole');
    } else {
      //console.log("CONTROL",holeId,"TRACKER",hole['TRACKER_HOLE'],"DURATION",noteLength,"X",pointX,"Y",pointY);
      noteElt.title = midiNumber.toString() + " (" + holeId + ") tick " + tick;
      noteElt.classList.add('control-hole');
    }

    let rectViewport = openSeadragon.viewport.imageToViewportRectangle(pointX, pointY, colWidth, noteLength);
    openSeadragon.viewport.viewer.addOverlay(noteElt, rectViewport);

    paintedHoles[holeId] = offTime;

    if (holeOverlays[offTime] === undefined) {
      holeOverlays[offTime] = [noteElt];
    } else {
      holeOverlays[offTime].push(noteElt);
    }

  });
}

const getViewableY = function() {
  // Get viewport Y bounds in image coords
  let viewableImage = openSeadragon.viewport.viewportToImageRectangle(openSeadragon.viewport.getBounds());

  // XXX Need to reverse this for bottom-up scrolling rolls
  let firstPx = parseInt(viewableImage.y);
  let lastPx = firstPx + parseInt(viewableImage.height);
  return [firstPx, lastPx];
}

const overlayHolesInWindow = function() {

  if (!showRoll || !paintHoles) {
    return;
  }

  // Get viewport Y bounds in image coords
  const [firstPx, lastPx] = getViewableY();
  let firstTick = firstPx - firstHolePx;
  let lastTick = lastPx - firstHolePx;
  if (scrollUp) {
    firstTick = firstHolePx - firstPx;
    lastTick = firstHolePx - lastPx;
  }

  // Show all overlays that overlap with the viewer window
  for (let tick=firstTick; tick<=lastTick; tick++) {
    if (tick in holesInfo) {
      overlayHolesAtTick(tick);
    }
  }
}

const midiEvent = function (event) {

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
    // This ignores velcity 0 events on the higher control tracks -- not good?
    if ((event.velocity === 0) && (event.track >= 2) && (event.track <= 3)) {

      while (activeNotes.includes(parseInt(noteNumber))) {
        activeNotes.splice(activeNotes.indexOf(parseInt(noteNumber)), 1);
      }
      stopNote(noteNumber);

    //} else if (event.track > 3) {
      //console.log("NOTE ON AT TICK",event.tick,noteNumber,"TRACK",event.track,"LIKELY CONTROL");

    //} else if ((noteNumber < 21) || (noteNumber > 108)) {
      //console.log("NOTE ON AT TICK",event.tick,noteNumber,"TRACK",event.track,"POSSIBLY CONTROL");

    } else {
      //console.log("NOTE ON AT TICK",event.tick,noteNumber,"TRACK",event.track,"VELOCITY",event.velocity);

      /* Visualize note on roll */
      if (showRoll) {
        //console.log("VISUALIZING NOTE AT",event.tick,"NOTE",noteNumber,getNoteName(noteNumber));

        if (holesInfo[event.tick] !== undefined) {
           /* Use hole analysis report data, if available */
           updateOverlays(event.tick);
        
        } else {

          /* No hole analysis data available; build overlays from notesMap and guesswork. */

          clearOverlaysBeforeTick(event.tick);

          // The use of holeSep seems to be correct, but the X offset is a total guess
          let noteOffset = 0;

          let noteNudge = 0;

          if (rollMetadata["ROLL_TYPE"] !== "welte-red") {
            noteOffset = noteNumber - POPULAR_NOTES_START;
            noteNudge = holeSep / 2.0;
          } else {
            noteOffset = noteNumber - WELTE_RED_NOTES_START;
            noteNudge = holeSep;
          }

          const noteName = getNoteName(noteNumber);

          let pointX = noteOffset * holeSep + noteNudge;

          // This will be overridden almost always
          let offTime = event.tick + overlayPersist;

          if ((notesMap[event.tick] !== undefined ) && (notesMap[event.tick][noteNumber] !== undefined)) {
            offTime = notesMap[event.tick][noteNumber];
          }

          const noteLength = Math.abs(event.tick - offTime);

          let pointY = linePx;
          if (scrollUp) {
            pointY = linePx - noteLength;
          }

          let noteRect = document.createElement("div");
          if (event.track <= 3) {
            noteRect.classList.add('music-hole');
          } else {
            noteRect.classList.add('control-hole')
          }
          noteRect.title = noteName;

          let rectViewport = openSeadragon.viewport.imageToViewportRectangle(pointX, pointY, holeWidth, noteLength);

          openSeadragon.viewport.viewer.addOverlay(noteRect, rectViewport);

          if (holeOverlays[offTime] === undefined) {
            holeOverlays[offTime] = [noteRect];
          } else {
            holeOverlays[offTime].push(noteRect);
          }
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
        pressSoftPedal();
      } else if (event.value == 0) {
        //console.log("SOFT OFF");
        releaseSoftPedal();
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

  if (samplePlayer.isPlaying()) {
    // Pause
    samplePlayer.pause();
    clearScrollTimer();
    playState = "paused";
  } else {
    // Play
    activeNotes.forEach((noteNumber) => {
      keyboardToggleKey(noteNumber, false);
    });
    activeNotes = [];
    playState = "playing";

    scrollTimer = setInterval(playerProgress, UPDATE_INTERVAL_MS);
    samplePlayer.play();
  }
};

const stopPlayback = function (noRoll) {
  if (samplePlayer.isPlaying() || playState === "paused") {
    samplePlayer.stop();
    clearScrollTimer();
    activeNotes.forEach((noteNumber) => {
      stopNote(noteNumber);
    });
    playState = "stopped";
    activeNotes = [];
    releaseSustainPedal();
    releaseSoftPedal();
    if (showRoll && openSeadragon) {
      clearOverlaysBeforeTick(samplePlayer.getCurrentTick(), true);
      openSeadragon.viewport.zoomTo(HOME_ZOOM);
      horizPos = .5;
      panViewportToTick(0);
    }
  }
};

const playerProgress = function () {
  if (samplePlayer && samplePlayer.isPlaying()) {
    currentTick = samplePlayer.getCurrentTick();
    if (showRoll) {
      panViewportToTick(currentTick);
      return;
    }
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
  if (!samplePlayer) {
    return;
  }

  currentTick = Math.max(0, targetTick);
  let playProgress = Math.max(0, targetProgress);

  if (useMidiTempos) {
    const currentTempo = tempoMap.search(currentTick, currentTick)[0];
    applyTempoChange(currentTempo);
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

const skipToPixel = function (pixelY) {

  let targetTick = pixelY - firstHolePx;
  if (scrollUp) {
    targetTick = firstHolePx - pixelY;
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

const panViewportToTick = function (tick, resetZoom) {
  /* PAN VIEWPORT IMAGE */

  if (!showRoll) {
    return;
  }

  // If this is fired from the scrollTimer event (quite likely) the tick
  // argument will be undefined, so we get it from the player itself.
  if (typeof tick === "undefined" || isNaN(tick) || tick === null) {
    tick = samplePlayer.getCurrentTick();
  }

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

  if (resetZoom === true) {
    horizPos = 0.5;
  }

  let lineCenter = new OpenSeadragon.Point(
    horizPos,
    lineViewport.y
  );

  let targetProgress = parseFloat(tick) / parseFloat(totalTicks);
  let playProgress = Math.max(0, targetProgress);
  currentTick = Math.max(0, tick);

  currentProgress = playProgress;

  updateProgress();

  openSeadragon.viewport.panTo(lineCenter);

  if (pedalsChart) {
    console.log("Adjusting pan/zoom of pedals chart");
    const [firstPx, lastPx] = getViewableY();
    pedalsChart.setZoom(firstPx - firstHolePx, lastPx - firstHolePx);
    //zoomPlugin.zoomScale(pedalsChart, "xaxis", [firstPx - firstHolePx, lastPx - firstHolePx]);
    //console.log(zoomPlugin);
  }

};

const pressSustainPedal = function (pedalInput) {
  if (pedalInput !== undefined) {
    if (!(pedalInput instanceof KeyboardEvent)) {
      // Physical MIDI pedal input is of type int
      sustainLevel = parseInt(pedalInput);
      if (sustainLevel == 0) {
        releaseSustainPedal();
      }
    } else {
      if (pedalInput.type == "keydown") {
        if (pedalInput.code == SUSTAIN_LESS_KEY) {
          if (pedalInput.shiftKey) {
            sustainLevel = Math.max(1, sustainLevel - 1);
          } else {
            sustainLevel = Math.max(1, sustainLevel - SUSTAIN_LEVEL_DELTA);
          }
        } else if (pedalInput.code == SUSTAIN_MORE_KEY) {
          if (pedalInput.shiftKey) {
            sustainLevel = Math.min(127, sustainLevel + 1);
          } else {
            sustainLevel = Math.min(127, sustainLevel + SUSTAIN_LEVEL_DELTA);
          }
        } else if (pedalInput.code == SUSTAIN_PEDAL_KEY) {
          if (sustainLevel == 0) {
            sustainLevel = 127;
          }
        }
      }
    }

    document.getElementById("sustainLevel").value = sustainLevel;
    document.getElementById("sustainLevelSlider").value = sustainLevel;
  }
  
  if (sustainLevel > 0) {
    const sustainRatio = parseFloat(parseFloat(sustainLevel) / 127.0);
    //console.log("PEDAL DOWN AT LEVEL",sustainRatio);
    // level is only consequential if modified Piano is being used
    piano.pedalDown({ level: sustainRatio });
    sustainPedalOn = true;
    document.getElementById("sustainPedal").classList.add("pressed");
  }
};

const releaseSustainPedal = function () {
  piano.pedalUp();
  if (midiOut) {
    midiOut.send([MIDI_CONTROL, MIDI_SUSTAIN, 0]);
  }
  sustainPedalOn = false;
  //console.log("SUSTAIN OFF");
  document.getElementById("sustainPedal").classList.remove("pressed");
};

const pressSoftPedal = function () {
  if (midiOut) {
    midiOut.send([MIDI_CONTROL, MIDI_SOFT, 127]);
  }
  softPedalOn = true;
  document.getElementById("softPedal").classList.add("pressed");
}

const releaseSoftPedal = function () {
  if (midiOut) {
    midiOut.send([MIDI_CONTROL, MIDI_SOFT, 0]);
  }
  softPedalOn = false;
  document.getElementById("softPedal").classList.remove("pressed");
}

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
    if (softPedalLocked) {
      //console.log("SOFT ON");
      pressSoftPedal();
    } else {
      //console.log("SOFT OFF");
      releaseSoftPedal();
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
    releaseSoftPedal();
  }
}

const toggleRoll = function (event) {

  showRoll = event.target.checked;
  if (event.target.checked) {
    stopPlayback();
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
    document.getElementById("scoreWrapper").hidden = false;
    document.getElementById("scoreWrapper").appendChild(scoreStorage);
    initScoreViewer();
    document
      .getElementById("prevScorePage")
      .addEventListener("click", changeScorePage, false);
    document
      .getElementById("nextScorePage")
      .addEventListener("click", changeScorePage, false);
  } else {
    let scoreNode = document.getElementById("scoreWrapper").children[0];
    if (scoreNode) {
      scoreStorage = scoreNode.cloneNode(true);
      scoreNode.remove();
    }
    document.getElementById("scoreWrapper").hidden = true;
  }
}

const changeScorePage = function (e) {

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
    showNavigationControl: true,
    panHorizontal: true,
    visibilityRatio: 1,
    defaultZoomLevel: HOME_ZOOM,
    minZoomLevel: 0.01,
    maxZoomLevel: 4,
    opacity: 1
  });

  openSeadragon.addHandler("pan", () => {
    updateOverlays();
  });

  openSeadragon.addHandler("zoom", (event) => {
    if (showRoll) {
      let center = openSeadragon.viewport.getCenter(true);
      horizPos = center.x;
      if (!activeOnly && (event.zoom < 1)) {
        openSeadragon.viewport.zoomTo(1);
      }
      updateOverlays();
    }
  });

  openSeadragon.addHandler("canvas-drag", () => {
    let center = openSeadragon.viewport.getCenter(true);
    let centerCoords = openSeadragon.viewport.viewportToImageCoordinates(center);
    horizPos = center.x;
    skipToPixel(centerCoords.y);
  });

}

/* INIT */

initOSD();

let globalPiano = null;

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
  document.getElementById("playPause").disabled = false;
  keyboard.enable();
  globalPiano = piano;
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

  let wasPlaying = false;

  if (playState === "playing") {
    playPausePlayback();
    wasPlaying = true;
  }

  document.getElementById("playPause").disabled = true;
  //document.getElementById("stop").disabled = true;
  globalPiano.dispose();

  piano = new Piano({
    url: BASE_DATA_URL + 'audio/mp3/', // works if avaialable
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
    //document.getElementById("stop").disabled = false;

    globalPiano = piano;
    if (wasPlaying && (playState === "paused")) {
       playPausePlayback();
    }
  });

});

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
  .getElementById("playExpressions")
  .addEventListener("click", toggleExpressions, false);

document
  .getElementById("useRollPedaling")
  .addEventListener("click", toggleRollPedaling, false);

document
  .getElementById("useMidiTempos")
  .addEventListener("click", toggleMidiTempos, false);

document
  .getElementById("activeOnly")
  .addEventListener("click", toggleActiveOnly, false);

document
  .getElementById("blankRoll")
  .addEventListener("click", toggleBlankRoll, false);

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
        pressSustainPedal(event);
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
        pressSoftPedal();
      } else {
        if (!softPedalOn) {
          break;
        }
        releaseSoftPedal();
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
    .then(function(midi) {

      // Get lists of available MIDI controllers
      //const inputs = access.inputs.values();
      //const outputs = access.outputs.values();

      Array.from(midi.inputs).forEach(input => {
        input[1].onmidimessage = (msg) => {
          if (msg.data.length > 1) {
            // 176 probably = control change; 64 = sustain pedal
            // SUSTAIN PEDAL MSGS ARE 176, 64, 0-127
            // KEYPRESS MSGS ARE 144, [MIDI_NUMBER], 0-100?
            if ((msg.data[0] == MIDI_CONTROL) && (msg.data[1] == MIDI_SUSTAIN)) {
              pressSustainPedal(parseInt(msg.data[2]));
            } else if (msg.data[0] == MIDI_NOTE_ON) {
              if (msg.data[2] == 0) {
                midiNotePlayer(msg.data[1], false);
              } else {
                midiNotePlayer(msg.data[1], true, msg.data[2]);
              }            
            } else if (msg.data[0] == MIDI_NOTE_OFF) {
              midiNotePlayer(msg.data[1], false);
            }
          }
        }
      })

      Array.from(midi.outputs).forEach(output => {
        midiOut = output[1];
      });

      midi.onstatechange = function(e) {
        // Print information about the (dis)connected MIDI controller
        console.log(e.port.name, e.port.manufacturer, e.port.state);
      };
    });
} else {
  console.log('WebMIDI is not supported in this browser.');
}

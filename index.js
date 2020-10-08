import MidiPlayer from "midi-player-js"; // Decodes and plays back MIDI data
import Soundfont from "soundfont-player"; // Generates sounds for MIDI events
import OpenSeadragon from 'openseadragon';
import IntervalTree from 'node-interval-tree';
import verovio from 'verovio';
import { v4 as uuidv4 } from 'uuid';
import Keyboard from 'piano-keyboard';

const ADSR_SAMPLE_DEFAULTS = { "attack": 0.01, "decay": 0.1, "sustain": 0.9, "release": 0.3 };
const UPDATE_INTERVAL_MS = 100;
const SHARP_NOTES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
const FLAT_NOTES = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
const SOFT_PEDAL_RATIO = .67;
const DEFAULT_NOTE_VELOCITY = 33.0;
const HALF_BOUNDARY = 66; // F# above Middle C; divides the keyboard into two "pans"
const HOME_ZOOM = 1;
let midiData = require("./mididata.json");
let scoreData = require("./scoredata.mei.json");

const recordings_data = { 'zb497jz4405': { 'slug': 'mozart_rondo_alla_turca', 'title': 'Mozart/Reinecke - Türkischer Marsch', 'image_url': 'https://stacks.stanford.edu/image/iiif/zb497jz4405%2Fzb497jz4405_0001/info.json' },
                          'yj598pj2879': { 'slug': 'liszt_soirees_de_vienne', 'title': 'Liszt/Carreño - Soirées de Vienne, no. 6', 'image_url': 'https://stacks.stanford.edu/image/iiif/yj598pj2879%2Fyj598pj2879_0001/info.json' },
                          'pz594dj8436': { 'slug': 'alonso_las_corsarias', 'title': 'F. Alonso: Las corsarias: Selecciones', 'image_url': 'https://stacks.stanford.edu/image/iiif/pz594dj8436%2Fpz594dj8436_0002/info.json' }
						            }

let AudioContext = window.AudioContext || window.webkitAudioContext || false; 
let ac = null; // Audio Context
let currentRecording = null;
let rollMetadata = {};
let samplePlayer = null; // the MIDI player
let scorePlayer = null;
let playState = "stopped";
let instrument = null;
let adsr = ADSR_SAMPLE_DEFAULTS;
let totalTicks = 0;
let currentTick = 0;
let currentProgress = 0.0;
let sampleInst = 'acoustic_grand_piano';
let activeAudioNodes = {};
let volumeRatio = 1.0;
let leftVolumeRatio = 1.0;
let rightVolumeRatio = 1.0;
let baseTempo = null;
let tempoRatio = 1.0;
let sliderTempo = 60.0;
let playbackTempo = 0.0;
let activeNotes = [];
let sustainedNotes = [];
let sustainPedalOn = false;
let softPedalOn = false;
let sustainPedalLocked =false;
let softPedalLocked = false;
let panBoundary = HALF_BOUNDARY;
let pedalMap = null;

let openSeadragon = null;
let firstHolePx = 0;
let scrollTimer = null;
let viewerId = uuidv4();

let scorePages = [];
let scoreMIDI = [];
let scorePlaying = false;
let currentScorePage = 1;
let highlightedNotes = [];
let currentRecordingId = Object.keys(recordings_data)[2];
let vrvToolkit = null;
let RecordingOptions = []; // Elements for menu of Recordings to play

let scrollUp = false;

let keyboard = null;


const loadRecording = function(e, currentRecordingId) {

  if (e) {
    currentRecordingId = e.target.value;
	}

	if (samplePlayer && (samplePlayer.isPlaying() || (playState === "paused"))) {
		samplePlayer.stop();
	}
	if (scrollTimer) {
		clearInterval(scrollTimer);
		scrollTimer = null;
  }
  activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
  activeAudioNodes = {};
  activeNotes = [];
  sustainedNotes = [];
  highlightedNotes = [];
  releaseSustainPedal();
  softPedalOn = false;
  document.getElementById("softPedal").classList.remove("pressed");

	openSeadragon.addOnceHandler("update-viewport", () => {
		panViewportToTick(0);
	});
	
	console.log("loading Recording ID", currentRecordingId);
	
	document.getElementById('recordings').value = currentRecordingId;

    let recordingSlug = recordings_data[currentRecordingId]['slug'];
    currentRecording = midiData[recordingSlug];

	openSeadragon.open(recordings_data[currentRecordingId]['image_url']);
    
  initPlayer();
  
  scorePlayer = null;

  /* load the MEI data as string into the toolkit */
  if (recordingSlug in scoreData) {

	  vrvToolkit.loadData(scoreData[recordingSlug]);
	
	  /* render the fist page as SVG */
    scorePages = [];
    for (let i=1; i<=vrvToolkit.getPageCount(); i++) {
      scorePages.push(vrvToolkit.renderToSVG(i, {}));
	  }
	
    document.getElementById("scorePage").innerHTML = scorePages[currentScorePage-1];

	  scoreMIDI = "data:audio/midi;base64," + vrvToolkit.renderToMIDI();

	  /* Instantiate the score MIDI player */
    scorePlayer = new MidiPlayer.Player();

    scorePlayer.on('midiEvent', function(e) {

      const timeMultiplier = parseFloat(scorePlayer.getSongTime() * 1000.0) / parseFloat(scorePlayer.totalTicks);

      let vrvTime = parseInt(e.tick*timeMultiplier) + 1;

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
          document.getElementById("scorePage").innerHTML = scorePages[currentScorePage-1];
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

    scorePlayer.on('endOfFile', function() {
      console.log("END OF FILE");
      playScore(false);
      // Do something when end of the file has been reached.
    });

    // Load MIDI data
    scorePlayer.loadDataUri(scoreMIDI);

  }

	updateProgress();

}

/* SAMPLE-BASED PLAYBACK USING midi-player-js AND soundfont-player */

const initPlayer = function() {

    /* Instantiate the MIDI player */
    let MidiSamplePlayer = new MidiPlayer.Player();

    /* Various event handlers, mostly used for debugging */
    MidiSamplePlayer.on('fileLoaded', () => {
      console.log("data loaded");

      function decodeCharRefs(string) {
        return string
            .replace(/&#(\d+);/g, function(match, num) {
                return String.fromCodePoint(num);
            })
            .replace(/&#x([A-Za-z0-9]+);/g, function(match, num) {
                return String.fromCodePoint(parseInt(num, 16));
            });
      }

      firstHolePx = 0;
      let lastHolePx = 0;
      let holeWidthPx = 0;
      baseTempo = null;
      let earliestTempoTick = null;
      rollMetadata = {};
      const metadataRegex = /^@(?<key>[^:]*):[\t\s]*(?<value>.*)$/;

      pedalMap = new IntervalTree();

      // Pedal events should be duplicated on each track, but best not to assume
      // this will always be the case. Assume however that the events are
      // always temporally ordered in each track.
      MidiSamplePlayer.events.forEach((track) => {
        let sustainOn = false;
        let softOn = false;
        let sustainStart = 0;
        let softStart = 0;
        track.forEach((event) => {
          if (event.name === "Controller Change") {
            // Sustain pedal on/off
            if (event.number == 64) {
              if ((event.value == 127) && (sustainOn != true)) {
                sustainOn = true;
                sustainStart = event.tick;
              } else if (event.value == 0) {
                sustainOn = false;
                pedalMap.insert(sustainStart, event.tick, "sustain");
              }
            // Soft pedal on/off
            } else if (event.number == 67) {
              // Consecutive "on" events just mean "yep, still on" ??
              if ((event.value == 127) && (softOn != true)) {
                softOn = true;
                softStart = event.tick;
              } else if (event.value == 0) {
                softOn = false;
                pedalMap.insert(softStart, event.tick, "soft");
              }
            }
          } else if (event.name === "Set Tempo") {
            if ((earliestTempoTick === null) || (event.tick < earliestTempoTick)) {
              baseTempo = event.data;
              earliestTempoTick = event.tick;
            }
          } else if (event.name === "Text Event") {
            let text = decodeCharRefs(event.string);
            if (!text) return;
            /* @IMAGE_WIDTH and @IMAGE_LENGTH should be the same as from viewport._contentSize
            * Can't think of why they wouldn't be, but maybe check anyway. Would need to scale
            * all pixel values if so.
            * Other potentially useful values, e.g., for drawing overlays:
            * @ROLL_WIDTH (this is smaller than the image width)
            * @HARD_MARGIN_TREBLE
            * @HARD_MARGIN_BASS
            * @HOLE_SEPARATION
            * @HOLE_OFFSET
            * All of the source/performance/recording metadata is in this track as well.
            */
            const found = text.match(metadataRegex);
            rollMetadata[found.groups.key] = found.groups.value;
          }
        });
    });
    
    console.log(rollMetadata);

	  document.getElementById('title').innerText = rollMetadata['TITLE'];
	  document.getElementById('performer').innerText = rollMetadata['PERFORMER'];
	  document.getElementById('composer').innerText = rollMetadata['COMPOSER'];
	  document.getElementById('label').innerText = rollMetadata['LABEL'];
	  document.getElementById('purl').innerHTML = '<a href="' + rollMetadata['PURL'] + '">' + rollMetadata['PURL'] + '</a>';
  //   document.getElementById('callno').innerText = rollMetadata['CALLNUM'];
  
    scrollUp = false;
    if (rollMetadata['ROLL_TYPE'] !== "welte-red") {
      scrollUp = true;
    }

    firstHolePx = parseInt(rollMetadata['FIRST_HOLE']);
    if (scrollUp) {
      firstHolePx = parseInt(rollMetadata['IMAGE_LENGTH']) - firstHolePx;
    }

    lastHolePx = parseInt(rollMetadata['LAST_HOLE']);
	  holeWidthPx = parseInt(rollMetadata['AVG_HOLE_WIDTH']);
	  
	  let rollWidth = parseInt(rollMetadata['ROLL_WIDTH']);

      /*
      // Play line can be drawn via CSS (though not as accurately), but very
      // similar code to this would be used to show other overlays, e.g., to
      // "fill" in actively playing notes and other mechanics. Performance is
      // an issue, though.
      let startBounds = openSeadragon.viewport.getBounds();
      let playPoint = new OpenSeadragon.Point(0, startBounds.y + (startBounds.height / 2.0));
      let playLine = openSeadragon.viewport.viewer.getOverlayById('play-line');
      if (!playLine) {
        playLine = document.createElement("div");
        playLine.id = "play-line";
        openSeadragon.viewport.viewer.addOverlay(playLine, playPoint, OpenSeadragon.Placement.TOP_LEFT);
      } else {
        playLine.update(playPoint, OpenSeadragon.Placement.TOP_LEFT);
      }
      */

    });
    
    MidiSamplePlayer.on('playing', currentTick => {
        // Do something while player is playing
        // (this is repeatedly triggered within the play loop)
    });
    
    MidiSamplePlayer.on('midiEvent', midiEvent);
    
    MidiSamplePlayer.on('endOfFile', (function() {
        console.log("END OF FILE");
        stopPlayback();
		// Do something when end of the file has been reached.
		panViewportToTick(0);
    }));

	samplePlayer = MidiSamplePlayer;

    /* Load MIDI data */
	samplePlayer.loadDataUri(currentRecording);

	totalTicks = samplePlayer.totalTicks;

}

const midiEvent = function(event) {

	//console.log("MIDI EVENT",event);

    // Do something when a MIDI event is fired.
    // (this is the same as passing a function to MidiPlayer.Player() when instantiating).
    if (event.name === 'Note on') {

      const noteNumber = event.noteNumber;
      //const noteName = getNoteName(noteNumber);
      let noteVelocity = event.velocity;

      // Note off
      if (noteVelocity === 0) {
        //console.log("OFF",noteNumber,getNoteName(noteNumber));
        /*if (sustainedNotes.includes(noteNumber)) {
          console.log("SUSTAIN PEDAL IS ON, KEEPING NOTE PLAYING");
        }*/

        if (!sustainedNotes.includes(noteNumber)) {
          try {
            activeAudioNodes[noteNumber].stop(ac.currentTime);
          } catch(error) {
			console.log("COULDN'T STOP",noteNumber,getNoteName(noteNumber));
			console.log(error);
          }
          delete activeAudioNodes[noteNumber];
        }
        while(activeNotes.includes(parseInt(noteNumber))) {
          activeNotes.splice(activeNotes.indexOf(parseInt(noteNumber)), 1);
        }

        keyboardToggleKey(noteNumber, false);
      
      // Note on
      } else {
        //console.log("ON",noteNumber,getNoteName(noteNumber))
        if (sustainedNotes.includes(noteNumber)) {
          //console.log("NOTE STILL SUSTAINED WHEN RE-TOUCHED, STOPPING");
          try {
            activeAudioNodes[noteNumber].stop();
          } catch {
            console.log("Tried and failed to stop sustained note being re-touched",noteNumber);
          }
          delete activeAudioNodes[noteNumber];
        }

        let updatedVolume = noteVelocity/100.0 * volumeRatio;
        if (softPedalOn) {
          updatedVolume *= SOFT_PEDAL_RATIO;
        }
        if (parseInt(noteNumber) < panBoundary) {
          updatedVolume *= leftVolumeRatio;
        } else if (parseInt(noteNumber) >= panBoundary) {
          updatedVolume *= rightVolumeRatio;
        }

        try {
          adsr = [adsr['attack'], adsr['decay'], adsr['sustain'], adsr['release']];
          
          let noteNode = instrument.play(noteNumber, ac.currentTime, { gain: updatedVolume /*, adsr */ });
          activeAudioNodes[noteNumber] = noteNode;
        } catch(error) {
          // Get rid of this eventually
          console.log("NOTE PLAY ERROR",error);
          adsr = [ADSR_SAMPLE_DEFAULTS['attack'], ADSR_SAMPLE_DEFAULTS['decay'], ADSR_SAMPLE_DEFAULTS['sustain'], ADSR_SAMPLE_DEFAULTS['release']];
          let noteNode = instrument.play(noteNumber, ac.currentTime, { gain: updatedVolume, adsr });
          activeAudioNodes[noteNumber] = noteNode;
        }
        if (sustainPedalOn && !sustainedNotes.includes(noteNumber)) {
          sustainedNotes.push(noteNumber);
        }

        if (!activeNotes.includes(noteNumber)) {
          activeNotes.push(parseInt(noteNumber));
        }

        keyboard.activeNotes.add(noteNumber);

        keyboardToggleKey(noteNumber, true);
      }
    } else if (event.name === "Controller Change") {
      // Controller Change number=64 is a sustain pedal event;
      // 127 is down (on), 0 is up (off)
      if ((event.number == 64) && !sustainPedalLocked) {
        if (event.value == 127) {
          pressSustainPedal();
        } else if (event.value == 0) {
          releaseSustainPedal();
        }
      // 67 is the soft (una corda) pedal
      } else if (event.number == 67 && !softPedalLocked) {
        if (event.value == 127) {
		  softPedalOn = true;
		  document.getElementById("softPedal").classList.add("pressed");
        } else if (event.value == 0) {
		  softPedalOn = false;
		  document.getElementById("softPedal").classList.remove("pressed");
        }
      } else if (event.number == 10) {
        // Controller Change number=10 sets the "panning position",
        // which is supposed to divide the keyboard into portions,
        // presumably bass and treble. These values are a bit odd
        // however and it's not clear how to use them, e.g.,
        // track 2: value = 52, track 3: value = 76
        panBoundary = event.value;
      }
    } else if (event.name === "Set Tempo") {

      tempoRatio = 1 + (parseFloat(event.data) - parseFloat(baseTempo)) / parseFloat(baseTempo);
	  playbackTempo = parseFloat(sliderTempo) * tempoRatio;
	  
	  console.log("SETTING PLAYBACK TEMPO TO", playbackTempo)

      samplePlayer.setTempo(playbackTempo);
      if (scorePlayer) {
        scorePlayer.setTempo(playbackTempo);
      }
    }

    // The scrollTimer should ensure that the roll is synchronized with
    // playback; syncing at every note effect also can cause problems
    // on certain browsers if the playback events start to lag behind
    // their scheduled times.
    //panViewportToTick(event.tick);

}

const playPausePlayback = function() {

    if (scorePlaying) {
      return;
    }

    if (samplePlayer.isPlaying()) {
      samplePlayer.pause();
	  clearInterval(scrollTimer);
	  playState = "paused";
	  scrollTimer = null;
    } else {
      openSeadragon.viewport.zoomTo(HOME_ZOOM);
	    activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
	    playState = "playing";
	    // XXX Consider setting a timer to recycle AudioContext and sample player
	    // periodically to avoid Firefox fuzzout issue. This likely would case a
	    // noticeable skip during playback when it happens, though. 
	    if (ac) {
		    ac.close();
	    }
	    ac = new AudioContext();
	    Soundfont.instrument(ac, sampleInst, { soundfont: 'MusyngKite' }).then(function(inst) {
		    instrument = inst;
		    scrollTimer = setInterval(panViewportToTick, UPDATE_INTERVAL_MS);
		    samplePlayer.play();
	    });
    }
}

const stopPlayback = function() {
    if (samplePlayer.isPlaying() || (playState === "paused")) {

      samplePlayer.stop();
	  clearInterval(scrollTimer);
	  
	  ac.close().then(function () {
			activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
			playState = "stopped";
			scrollTimer = null;
			activeAudioNodes = {};
			activeNotes = [];
      releaseSustainPedal();
      softPedalOn = false;
      document.getElementById("softPedal").classList.remove("pressed");
  
		  ac = null;
		  instrument = null;
	  });

    }
}

const updateProgress = function() {

    if (totalTicks > 0) {
		currentProgress = parseFloat(currentTick) / parseFloat(totalTicks);
	}

	document.getElementById('progressSlider').value = currentProgress;
	document.getElementById('progressPct').innerText = (currentProgress * 100.).toFixed(2)+"%"
}

const skipTo = function(targetTick, targetProgress) {
    if (!(samplePlayer || scorePlayer)) {
      return;
	  }
	
    let playTick = Math.max(0, targetTick);
    let playProgress = Math.max(0, targetProgress);

    if (scorePlayer && scorePlaying) {
      scorePlayer.pause();
      scorePlayer.skipToTick(playTick);
      activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
      activeAudioNodes = {};
      activeNotes = [];
      sustainedNotes = [];
      currentProgress = playProgress;
      scorePlayer.play();
      updateProgress();
        return;
    }

    const pedalsOn = pedalMap.search(playTick, playTick);

    sustainPedalOn = sustainPedalLocked || pedalsOn.includes("sustain");
    softPedalOn = softPedalLocked || pedalsOn.includes("soft");

    if (samplePlayer.isPlaying()) {
      samplePlayer.pause();
      samplePlayer.skipToTick(playTick);
      activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
      activeAudioNodes = {};
      activeNotes = [];
      sustainedNotes = [];
      currentProgress = playProgress;
      samplePlayer.play();
    } else {
      samplePlayer.skipToTick(playTick);
      //panViewportToTick(targetTick);
	}
	updateProgress();
}

const skipToPixel = function(yPixel) {

    if (scorePlaying) {
      return;
    }

    let targetTick = yPixel - firstHolePx;
    if (scrollUp) {
      targetTick = firstHolePx - yPixel;
    }

    const targetProgress = parseFloat(targetTick) / parseFloat(totalTicks);

    skipTo(targetTick, targetProgress)
}

const skipToProgress = function(event) {
	const targetProgress = event.target.value;
	
	const targetTick = parseInt(parseFloat(targetProgress) * parseFloat(totalTicks));

    skipTo(targetTick, targetProgress);
}

const panViewportToTick = function(tick) {
    /* PAN VIEWPORT IMAGE */

    // If this is fired from the scrollTimer event (quite likely) the tick
    // argument will be undefined, so we get it from the player itself.
    if ((typeof(tick) === 'undefined') || isNaN(tick) || (tick === null)) {
      tick = samplePlayer.getCurrentTick();
    }

	  let viewportBounds = openSeadragon.viewport.getBounds();

    // Thanks to Craig, MIDI tick numbers correspond to pixels from the first
    // hole of the roll.

    let linePx = firstHolePx + tick;
    if (scrollUp) {
      linePx = firstHolePx - tick;
    }

    let lineViewport = openSeadragon.viewport.imageToViewportCoordinates(0,linePx);

    let lineCenter = new OpenSeadragon.Point(viewportBounds.width / 2.0, lineViewport.y);
    openSeadragon.viewport.panTo(lineCenter);

    let targetProgress = parseFloat(tick) / totalTicks;
    let playProgress = Math.max(0, targetProgress);
	let playTick = Math.max(0, tick);
	
	currentTick = playTick;
	currentProgress = playProgress;

	updateProgress();

}

const pressSustainPedal = function() {
    if (sustainPedalOn) {
      releaseSustainPedal();
      sustainedNotes = [];
    }
    activeNotes.forEach((noteNumber) => {
      if (!sustainedNotes.includes(noteNumber)) {
        sustainedNotes.push(noteNumber)
      }
	});
	//console.log("SUSTAIN ON");
	sustainPedalOn = true;
	document.getElementById("sustainPedal").classList.add("pressed");
}

const releaseSustainPedal = function() {
    sustainedNotes.forEach((noteNumber) => {
      if (!(activeNotes.includes(parseInt(noteNumber)))) {
        // XXX Maybe use a slower release velocity for pedal events?
        //console.log("NOTE OFF AT SUSTAIN PEDAL RELEASE",noteNumber,getNoteName(noteNumber));
        try {
          activeAudioNodes[noteNumber].stop();
        } catch {
          console.log("FAILED TO UNSUSTAIN",noteNumber);
        }
        delete activeAudioNodes[noteNumber];
      }
	});
	sustainPedalOn = false;
	//console.log("SUSTAIN OFF");
	sustainedNotes = [];
	document.getElementById("sustainPedal").classList.remove("pressed");
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
        softPedalOn = softPedalLocked;
      if (softPedalOn) {
        document.getElementById("softPedal").classList.add("pressed");
      } else {
        document.getElementById("softPedal").classList.remove("pressed");
      }
    }
}

const keyboardToggleKey = function(noteNumber, onIfTrue) {

    let keyElt = document.querySelector('div[data-key="' + (parseInt(noteNumber)-20).toString() + '"]');
    if (keyElt === null) {
      console.log("TRIED TO PLAY NONEXISTENT KEY:",noteNumber);
      return;
    }
    if (onIfTrue) {
      keyElt.classList.add("piano-keyboard-key-active");
    } else {
      keyElt.classList.remove("piano-keyboard-key-active");
    }
}

// This is for playing notes manually pressed (clicked) on the keyboard
const midiNotePlayer = function(noteNumber, onIfTrue /*, prevActiveNotes*/) {

	if (!ac || !instrument) {
	  ac = new AudioContext();
	  Soundfont.instrument(ac, sampleInst, { soundfont: 'MusyngKite' }).then(function(inst) {
		instrument = inst;
		midiNotePlayer(noteNumber, onIfTrue);
	  });
	  return;
	}

    if (onIfTrue) {
      let updatedVolume = DEFAULT_NOTE_VELOCITY/100.0 * volumeRatio;
      if (softPedalOn) {
        updatedVolume *= SOFT_PEDAL_RATIO;
      }
      if (parseInt(noteNumber) < HALF_BOUNDARY) {
        updatedVolume *= leftVolumeRatio;
      } else if (parseInt(noteNumber) >= HALF_BOUNDARY) {
        updatedVolume *= rightVolumeRatio;
      }
      if (noteNumber in activeAudioNodes) {
        try {
          activeAudioNodes[noteNumber].stop();
        } catch {
          console.log("Keyboard tried and failed to stop playing note to replace it",noteNumber);
        }
      }
      if (sustainPedalOn && !sustainedNotes.includes(noteNumber)) {
		sustainedNotes.push(noteNumber);
      }
	  const audioNode = instrument.play(noteNumber, ac.currentTime, {gain: updatedVolume});
	  activeAudioNodes[noteNumber] = audioNode;
    } else {
        if (!activeAudioNodes[noteNumber] || (sustainPedalOn && sustainedNotes.includes(noteNumber))) {
          return;
        }
        const audioNode = activeAudioNodes[noteNumber];
		audioNode.stop();
		delete activeAudioNodes[noteNumber];
    }
}

const updateTempoSlider = function(event) {

    playbackTempo = event.target.value * tempoRatio;

    if (scorePlayer && scorePlaying) {
      scorePlayer.pause();
      scorePlayer.setTempo(playbackTempo);
	  scorePlayer.play();
	  sliderTempo = event.target.value;
      return;
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

	sliderTempo = event.target.value;

	document.getElementById("tempo").innerText = sliderTempo + " bpm";
}

const updateVolumeSlider = function(event) {

	let sliderName = event.target.name;

    if (sliderName === "volume") {
		volumeRatio = event.target.value;
	} else if (sliderName === "leftVolume") {
		leftVolumeRatio = event.target.value;
	} else if (sliderName === "rightVolume") {
		rightVolumeRatio = event.target.value;
	}

}

const changeInstrument = function(e) {
    const newInstName = e.target.value;

    // XXX This mostly works, except that when switching back to the
    // acoustic_grand_piano, the bright_acoustic_piano plays instead.
    // Possibly this problem is rooted in how the soundfonts are
    // defined, i.e., if the bright_acoustic is just a modification of
    // the samples in acoustic_grand, the system may erroneously
	// assume they're the same...
	if (ac) {
		ac.close().then(() => {
			ac = new AudioContext();
			Soundfont.instrument(ac, newInstName, { soundfont: 'FluidR3_GM' }).then(
				(inst) => {
					instrument = inst;
					sampleInst = newInstName;
				});
		});
	} else {
		ac = new AudioContext();
		Soundfont.instrument(ac, newInstName, { soundfont: 'FluidR3_GM' }).then(
			(inst) => {
				instrument = inst;
				sampleInst = newInstName;
			});
	}
}

const scorePlayback = function(e) {

  if (scorePlayer === null) {
    return;
  }

	if ((e.target.name === "playScore") && (!scorePlaying) && (!samplePlayer.isPlaying()) && (playState !== "paused")) {

		activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
		scorePlaying = true;
		currentScorePage = 1;
		document.getElementById("scorePage").innerHTML = scorePages[currentScorePage-1];
		activeNotes = [];
		totalTicks = scorePlayer.totalTicks;

		if (!instrument) {
			ac = new AudioContext();
			Soundfont.instrument(ac, sampleInst, { soundfont: 'MusyngKite' }).then(function(inst) {
				instrument = inst;
				scorePlayer.play();
			});
		} else {
			scorePlayer.play();
		}
		
	} else if ((e.target.name === "stopScore") && (scorePlaying)) {
		scorePlaying = false;
		scorePlayer.stop();

		activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
	
		activeNotes = [];
		sustainedNotes = [];
		currentProgress = 0;
    releaseSustainPedal();
    softPedalOn = false;
    document.getElementById("softPedal").classList.remove("pressed");

    for (const nodeId in activeAudioNodes) {
      activeAudioNodes[nodeId].stop();
    }

		if (highlightedNotes && highlightedNotes.length > 0) {
			highlightedNotes.forEach((noteId) => {
				let noteElt = document.getElementById(noteId);
				if (noteElt) {
				noteElt.setAttribute("style", "fill: #000");
				}
			});
    }
    
    highlightedNotes = [];

		totalTicks = samplePlayer.totalTicks;
	}
}

const changeScorePage = function(e) {
    if (!scorePlayer || scorePlaying) {
		return;
	}
	if ((e.target.name == "prevPage") && (currentScorePage > 1)) {
		currentScorePage--;
		document.getElementById("scorePage").innerHTML = scorePages[currentScorePage-1];
	} else if ((e.target.name == "nextPage") && (currentScorePage < scorePages.length)) {
		currentScorePage++;
	    document.getElementById("scorePage").innerHTML = scorePages[currentScorePage-1];
	}

}

const getNoteName = function(noteNumber) {
    const octave = parseInt(noteNumber / 12) - 1;
    noteNumber -= 21;
    const name = SHARP_NOTES[noteNumber % 12];
    return name + octave;
}

const getMidiNumber = function(noteName) {
    let note = "";
    let octave = 0;
    for (let i = 0; i < noteName.length; i++) {
      let c = noteName.charAt(i);
      if (c >= '0' && c <= '9') {
        octave = parseInt(c);
      } else {
        note += c;
      }
    }
    let noteNumber = NaN;
    if (SHARP_NOTES.includes(note)) {
      noteNumber = ((octave - 1) * 12) + SHARP_NOTES.indexOf(note) + 21; 
    } else if (FLAT_NOTES.includes(note)) {
      noteNumber = ((octave -1) * 12) + FLAT_NOTES.indexOf(note) + 21; 
    }
    return noteNumber;    
}

/* INIT */

document.getElementsByName('osdLair')[0].id = viewerId;

openSeadragon = new OpenSeadragon({
	id: viewerId,
	showNavigationControl: false,
	panHorizontal: false,
	visibilityRatio: 1,
    defaultZoomLevel: HOME_ZOOM,
    minZoomLevel: .01,
    maxZoomLevel: 4
  });

openSeadragon.addHandler("canvas-drag", () => {
	let center = openSeadragon.viewport.getCenter();
	let centerCoords = openSeadragon.viewport.viewportToImageCoordinates(center);
	skipToPixel(centerCoords.y);
});

let keyboard_elt = document.querySelector('.keyboard');

keyboard = new Keyboard({
	element: keyboard_elt,
	range: ['a0', 'c8'],
	a11y: false
});

keyboard.on('noteOn', function ({which, volume, target}) {
				midiNotePlayer(which+20, true)})
			.on('noteOff', function ({which, volume, target}) {
				midiNotePlayer(which+20, false)});

let instChooser = document.getElementById("sampleInstrument");
instChooser.value = sampleInst;
instChooser.onchange = changeInstrument;

let recordingsChooser = document.getElementById("recordings");
recordingsChooser.onchange = loadRecording;
for (const recId in recordings_data) {
	let opt = document.createElement("option");
	opt.value = recId;
	opt.text = recordings_data[recId]['title']
	recordingsChooser.appendChild(opt);
}

let tempoSlider = document.getElementById("tempoSlider");
tempoSlider.value = sliderTempo;
tempoSlider.onchange = updateTempoSlider;

document.getElementById("masterVolumeSlider").value = volumeRatio;
document.getElementById("leftVolumeSlider").value = leftVolumeRatio;
document.getElementById("rightVolumeSlider").value = leftVolumeRatio;


verovio.module.onRuntimeInitialized = function() {

	///create the toolkit instance
	vrvToolkit = new verovio.toolkit();

	loadRecording(null, currentRecordingId);
};

document.getElementById("masterVolumeSlider").onchange = updateVolumeSlider;
document.getElementById("leftVolumeSlider").onchange = updateVolumeSlider;
document.getElementById("rightVolumeSlider").onchange = updateVolumeSlider;

document.getElementById("tempo").innerText = sliderTempo + " bpm";

document.getElementById('playPause').addEventListener("click", playPausePlayback, false);
document.getElementById('stop').addEventListener("click", stopPlayback, false);

document.getElementById('sustainPedal').addEventListener("click", togglePedalLock, false);
document.getElementById('softPedal').addEventListener("click", togglePedalLock, false);

document.getElementById('progressSlider').addEventListener("input", skipToProgress, false);

document.getElementById('prevScorePage').addEventListener("click", changeScorePage, false);
document.getElementById('nextScorePage').addEventListener("click", changeScorePage, false);

document.getElementById('playScorePage').addEventListener("click", scorePlayback, false);
document.getElementById('stopScorePage').addEventListener("click", scorePlayback, false);

import MidiPlayer from "midi-player-js"; // Decodes and plays back MIDI data
import Soundfont from "soundfont-player"; // Generates sounds for MIDI events
//import OpenSeadragon from 'openseadragon';
import IntervalTree from 'node-interval-tree';
//import verovio from 'verovio';
import { v4 as uuidv4 } from 'uuid';
import Keyboard from 'piano-keyboard';

const ADSR_SAMPLE_DEFAULTS = { "attack": 0.01, "decay": 0.1, "sustain": 0.9, "release": 0.3 };
const UPDATE_INTERVAL_MS = 100;
const SHARP_NOTES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
const FLAT_NOTES = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
const SOFT_PEDAL_RATIO = .67;
const DEFAULT_NOTE_VELOCITY = 33.0;
const HALF_BOUNDARY = 66; // F# above Middle C; divides the keyboard into two "pans"
let midiData = require("./mididata.json");
let scoreData = require("./scoredata.mei.json");

const recordings_data = { 'zb497jz4405': { 'slug': 'mozart_rondo_alla_turca', 'title': 'Mozart/Reinecke - Türkischer Marsch', 'image_url': 'https://stacks.stanford.edu/image/iiif/zb497jz4405%2Fzb497jz4405_0001/info.json' },
                          'yj598pj2879': { 'slug': 'liszt_soirees_de_vienne', 'title': 'Liszt/Carreño - Soirées de Vienne, no. 6', 'image_url': 'https://stacks.stanford.edu/image/iiif/yj598pj2879%2Fyj598pj2879_0001/info.json' }
						}

let AudioContext = window.AudioContext || window.webkitAudioContext || false; 
let ac = null; // Audio Context
let currentSong = null;
let rollMetadata = {};
let samplePlayer = null; // the MIDI player
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
let homeZoom = null;

let viewerId = uuidv4();
let scorePages = [];
let scoreMidi = [];
let scorePlaying = false;
let currentScorePage = 1;
let highlightedNotes = [];
let currentSongId = Object.keys(recordings_data)[1];
let vrvToolkit = null;
let songOptions = []; // Elements for menu of songs to play

let keyboard = null;


const loadSong = function(e, currentSongId) {

    if (e) {
      currentSongId = e.target.value;
    }

    console.log("loading song ID", currentSongId);

    let songSlug = recordings_data[currentSongId]['slug'];
    currentSong = midiData[songSlug];

    //openSeadragon.open(recordings_data[currentSongId]['image_url']);

	Soundfont.instrument(ac, sampleInst, { soundfont: 'MusyngKite' }).then(initPlayer);

	/* load the MEI data as string into the toolkit */
	//vrvToolkit.loadData(scoreData[songSlug]);
	
	/* render the fist page as SVG */
	/*
    let scorePages = [];
    for (let i=1; i<=vrvToolkit.getPageCount(); i++) {
      scorePages.push(vrvToolkit.renderToSVG(i, {}));
    }
	let scoreMIDI = "data:audio/midi;base64," + vrvToolkit.renderToMIDI();
	*/

	/* Instantiate the score MIDI player */
	/*
    let MidiSamplePlayer = new MidiPlayer.Player();

    MidiSamplePlayer.on('fileLoaded', () => {
      this.setState({ scorePlayer: MidiSamplePlayer, highlightedNotes: [] });
    });

	MidiSamplePlayer.on('midiEvent', function(e) {

		const timeMultiplier = parseFloat(MidiSamplePlayer.getSongTime() * 1000.0) / parseFloat(MidiSamplePlayer.totalTicks);
  
		let vrvTime = parseInt(e.tick*timeMultiplier) + 1;
  
		let elementsattime = vrvToolkit.getElementsAtTime(vrvTime);
  
		let lastNoteIds = this.state.highlightedNotes;
		if (lastNoteIds && lastNoteIds.length > 0) {
		  lastNoteIds.forEach((noteId) => {
			let noteElt = document.getElementById(noteId);
			noteElt.setAttribute("style", "fill: #000");
		  });
		}
  
		if (elementsattime.page > 0) {
		  if (elementsattime.page != this.state.currentScorePage) {
			let page = elementsattime.page;
			this.setState({currentScorePage: page});
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
		this.setState({ highlightedNotes: noteIds });
  
		this.midiEvent(e);
	  }.bind(this));
  
	  MidiSamplePlayer.on('endOfFile', function() {
		console.log("END OF FILE");
		this.playScore(false);
		// Do something when end of the file has been reached.
	  }.bind(this));

	  // Load MIDI data
      MidiSamplePlayer.loadDataUri(scoreMIDI);

	*/
}


/* SAMPLE-BASED PLAYBACK USING midi-player-js AND soundfont-player */

const initPlayer = function(inst) {

    /* Instantiate the MIDI player */
    let MidiSamplePlayer = new MidiPlayer.Player();

    /* Various event handlers, mostly used for debugging */

    // This is how to know when a note sample has finished playing
    inst.on('ended', (when, name) => {
      //console.log('ended', name)
    });

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

      // openSeadragon.viewport.fitHorizontally(true);

      //let viewportBounds = openSeadragon.viewport.getBounds();

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

      firstHolePx = parseInt(rollMetadata['FIRST_HOLE']);
      lastHolePx = parseInt(rollMetadata['LAST_HOLE']);
      holeWidthPx = parseInt(rollMetadata['AVG_HOLE_WIDTH']);

      //let firstLineViewport = \openSeadragon.viewport.imageToViewportCoordinates(0,firstHolePx);

      //let bounds = new OpenSeadragon.Rect(0.0,firstLineViewport.y - (viewportBounds.height / 2.0),viewportBounds.width, viewportBounds.height);

      //openSeadragon.viewport.fitBounds(bounds, true);

      //let homeZoom = openSeadragon.viewport.getZoom();

      /*
      // Play line can be drawn via CSS (though not as accurately), but very
      // similar code to this would be used to show other overlays, e.g., to
      // "fill" in actively playing notes and other mechanics. Performance is
      // an issue, though.
      let startBounds = this.state.openSeadragon.viewport.getBounds();
      let playPoint = new OpenSeadragon.Point(0, startBounds.y + (startBounds.height / 2.0));
      let playLine = this.state.openSeadragon.viewport.viewer.getOverlayById('play-line');
      if (!playLine) {
        playLine = document.createElement("div");
        playLine.id = "play-line";
        this.state.openSeadragon.viewport.viewer.addOverlay(playLine, playPoint, OpenSeadragon.Placement.TOP_LEFT);
      } else {
        playLine.update(playPoint, OpenSeadragon.Placement.TOP_LEFT);
      }
      */

	  instrument = inst;

      // XXX Sometimes, on song change, the viewport doesn't automatically jump
      // to the starting bounds+zoom for the new song. Not sure why.
      // Maybe try adding a this.skipToTick(0) here?
      //openSeadragon.viewport.zoomTo(homeZoom);

    });
    
    MidiSamplePlayer.on('playing', currentTick => {
        // Do something while player is playing
        // (this is repeatedly triggered within the play loop)
    });
    
    MidiSamplePlayer.on('midiEvent', midiEvent);
    
    MidiSamplePlayer.on('endOfFile', (function() {
        console.log("END OF FILE");
        stopSong();
        // Do something when end of the file has been reached.
    }));

	samplePlayer = MidiSamplePlayer;

    /* Load MIDI data */
    MidiSamplePlayer.loadDataUri(currentSong);

}

const midiEvent = function(event) {

	console.log("MIDI EVENT",event);

    // Do something when a MIDI event is fired.
    // (this is the same as passing a function to MidiPlayer.Player() when instantiating).
    if (event.name === 'Note on') {

      const noteNumber = event.noteNumber;
      //const noteName = this.getNoteName(noteNumber);
      let noteVelocity = event.velocity;

      // Note off
      if (noteVelocity === 0) {
        console.log("OFF",noteNumber,getNoteName(noteNumber));
        if (sustainedNotes.includes(noteNumber)) {
          console.log("SUSTAIN PEDAL IS ON, KEEPING NOTE PLAYING");
        }

        if (!sustainedNotes.includes(noteNumber)) {
          try {
            console.log(activeAudioNodes[noteNumber]);
            activeAudioNodes[noteNumber].stop(ac.currentTime);
          } catch(error) {
			console.log("COULDN'T STOP",noteNumber,getNoteName(noteNumber));
			console.log(error,activeAudioNodes[noteNumber]);
            //this.setState({ adsr: ADSR_SAMPLE_DEFAULTS });
          }
          delete activeAudioNodes[noteNumber];
        }
        while(activeNotes.includes(parseInt(noteNumber))) {
          activeNotes.splice(activeNotes.indexOf(parseInt(noteNumber)), 1);
        }

        keyboardToggleKey(noteNumber, false);
      
      // Note on
      } else {
        console.log("ON",noteNumber,getNoteName(noteNumber))
        if (sustainedNotes.includes(noteNumber)) {
          console.log("NOTE STILL SUSTAINED WHEN RE-TOUCHED, STOPPING");
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
          console.log(noteNode);
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
        //this.setState({ panBoundary: event.value });
      }
    } else if (event.name === "Set Tempo") {

      const tempoRatio = 1 + (parseFloat(event.data) - parseFloat(baseTempo)) / parseFloat(baseTempo);
	  const playbackTempo = parseFloat(sliderTempo) * tempoRatio;
	  
	  console.log("SETTING PLAYBACK TEMPO TO", playbackTempo)

      samplePlayer.setTempo(playbackTempo);
      //scorePlayer.setTempo(playbackTempo);
    }

    // The scrollTimer should ensure that the roll is synchronized with
    // playback; syncing at every note effect also can cause problems
    // on certain browsers if the playback events start to lag behind
    // their scheduled times.
    //this.panViewportToTick(event.tick);

}

const playPauseSong = function() {

    if (samplePlayer.isPlaying()) {
	  console.log("Pausing song");
      samplePlayer.pause();
	  //clearInterval(scrollTimer);
	  playState = "paused";
	  scrollTimer = null;
    } else {
      //openSeadragon.viewport.zoomTo(homeZoom);
      //let scrollTimer = setInterval(panViewportToTick, UPDATE_INTERVAL_MS);
	  activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
	  playState = "playing";
	  totalTicks = samplePlayer.totalTicks;
	  console.log("Playing song with total ticks", totalTicks);
      samplePlayer.play();
    }
}

const stopSong = function() {
    if (samplePlayer.isPlaying() || (playState === "paused")) {

      samplePlayer.stop();
      //clearInterval(scrollTimer);
	  activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
	  playState = "stopped";
	  scrollTimer = null;
	  activeAudioNodes = {};
	  activeNotes = [];
	  sustainedNotes = [];
	  sustainPedalOn = false;
	  softPedalOn = false;

      //panViewportToTick(0);
    }
}

const skipTo = function(targetTick, targetProgress) {
    if (!(samplePlayer || scorePlayer)) {
      return;
    }

    let playTick = Math.max(0, targetTick);
    let playProgress = Math.max(0, targetProgress);

	/*
    if (scorePlaying) {
      scorePlayer.pause();
      scorePlayer.skipToTick(playTick);
      activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
	  activeAudioNodes = {};
	  activeNotes = [];
	  sustained_notes = [];
	  currentProgress = playProgress;
	  scorePlayer.play();
      return;
	}
	*/

    const pedalsOn = pedalMap.search(playTick, playTick);

    sustainPedalOn = sustainPedalLocked || pedalsOn.includes("sustain");
    softPedalOn = softPedalLocked || pedalsOn.includes("soft");

    if (samplePlayer.isPlaying()) {
      samplePlayer.pause();
      samplePlayer.skipToTick(playTick);
	  activeNotes.forEach((noteNumber) => {keyboardToggleKey(noteNumber, false)});
	  activeAudioNodes = {};
	  activeNotes = [];
	  sustained_notes = [];
	  currentProgress = playProgress;
      samplePlayer.play();
    } else {
      samplePlayer.skipToTick(playTick);
      panViewportToTick(targetTick);
    }
  }

const skipToProgress = function(event) {
    const targetProgress = event.target.value;
    const targetTick = parseInt(targetProgress * parseFloat(totalTicks));

    skipTo(targetTick, targetProgress);
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
	sustainPedalOn = true;
	document.getElementById("sustainPedal").classList.add("pressed");
}

const releaseSustainPedal = function() {
    sustainedNotes.forEach((noteNumber) => {
      if (!(activeNotes.includes(parseInt(noteNumber)))) {
        // XXX Maybe use a slower release velocity for pedal events?
        console.log("NOTE OFF AT SUSTAIN PEDAL RELEASE",noteNumber,getNoteName(noteNumber));
        try {
          activeAudioNodes[noteNumber].stop();
        } catch {
          console.log("FAILED TO UNSUSTAIN",noteNumber);
        }
        delete activeAudioNodes[noteNumber];
      }
	});
	sustainPedalOn = false;
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
    if (onIfTrue) {
      keyElt.classList.add("piano-keyboard-key-active");
    } else {
      keyElt.classList.remove("piano-keyboard-key-active");
    }
}

  // This is for playing notes manually pressed (clicked) on the keyboard
const midiNotePlayer = function(noteNumber, onIfTrue /*, prevActiveNotes*/) {

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

    const playbackTempo = event.target.value * tempoRatio;

    if (scorePlaying) {
      scorePlayer.pause();
      scorePlayer.setTempo(playbackTempo);
	  scorePlayer.play();
	  sliderTempo = event.target.value;
      return;
    }

    // If not paused during tempo change, player jumps back a bit on
    // shift to slower playback tempo, forward on shift to faster tempo.
    // So we pause it.
    samplePlayer.pause();
    samplePlayer.setTempo(playbackTempo);
	samplePlayer.play();

	sliderTempo = event.target.value;

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
/*
Object.keys(recordings_data).forEach((songId, idx) => {
	songOptions.push(<option key={recordings_data[songId]['slug']} value={songId}>{recordings_data[songId]['title']}</option>)
  });
*/

/*
let openSeadragon = new OpenSeadragon({
	id: this.state.viewerId,
	showNavigationControl: false,
	visibilityRatio: 1
  });

openSeadragon.addHandler("canvas-drag", () => {
	let center = openSeadragon.viewport.getCenter();
	let centerCoords = openSeadragon.viewport.viewportToImageCoordinates(center);
	this.skipToPixel(centerCoords.y);
});
*/

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

/*
verovio.module.onRuntimeInitialized = function() {

	///create the toolkit instance
	let vrvToolkit = new verovio.toolkit();

	this.loadSong(null, this.state.currentSongId, ac, vrvToolkit);
}.bind(this);
*/

ac = new AudioContext();

loadSong(null, currentSongId, ac, vrvToolkit);

document.getElementById('playPause').addEventListener("click", playPauseSong, false);
document.getElementById('stop').addEventListener("click", stopSong, false);

document.getElementById('sustainPedal').addEventListener("click", togglePedalLock, false);
document.getElementById('softPedal').addEventListener("click", togglePedalLock, false);

document.getElementById('progressSlider').addEventListener("input", skipToProgress, false);
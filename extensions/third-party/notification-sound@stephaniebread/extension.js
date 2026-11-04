import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class NotificationSoundExtension extends Extension {
	enable() {
		this._soundPlayer = global.display.get_sound_player();

		// using map to store signals to safely remove unused signals
		this._sourceSignals = new Map();
		this._mainSignals = [];

		// looking for new notification sources
		let addedId = Main.messageTray.connect('source-added', (tray, source) => {
			this._connectToSource(source);
		});
		this._mainSignals.push({ obj: Main.messageTray, id: addedId });

		// removing unused sources
		let removedId = Main.messageTray.connect('source-removed', (tray, source) => {
			this._disconnectFromSource(source);
		});
		this._mainSignals.push({ obj: Main.messageTray, id: removedId });

		// connecting to currently active sources
		Main.messageTray.getSources().forEach(source => {
			this._connectToSource(source);
		});

		// cooldown for notification sound (500ms)
		this._lastPlayTime = 0;
		this._cooldown = 500;
	}

	_connectToSource(source) {
		// if extension is already connected to source, skip it
		if (this._sourceSignals.has(source)) return;


		let id = source.connect('notification-added', (source, notification) => {
			this._playSound(source);
		});
		this._sourceSignals.set(source, id);
	}

	_disconnectFromSource(source) {
		let id = this._sourceSignals.get(source);
		if (id) {
			source.disconnect(id);
			this._sourceSignals.delete(source);
		}
	}

	_playSound(source) {
		// do not disturb = no notification sound
		if (Main.messageTray.bannerBlocked) return;

		// sound cooldown
		let currentTime = Date.now();
		if (currentTime - this._lastPlayTime < this._cooldown) return;

		this._lastPlayTime = currentTime;

		// notification sound is used from the default sound theme
		this._soundPlayer.play_from_theme(
			'message-new-instant',
			'Notification Sound',
			null
		);
	}

	disable() {
		// unlock-dialog is used to allow notification sounds while screen is locked
		this._mainSignals.forEach(s => s.obj.disconnect(s.id));
		this._mainSignals = [];

		for (let [source, id] of this._sourceSignals) {
			source.disconnect(id);
		}

		this._sourceSignals.clear();
		this._sourceSignals = null;
		this._soundPlayer = null;
	}
}

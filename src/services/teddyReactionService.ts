import { DeviceEventEmitter } from 'react-native';
import { preferencesService } from './preferencesService';

export type TeddyReactionType =
  | 'RECORDING_SAVED'
  | 'TAKE_AGAIN'
  | 'TEDDY_PICK'
  | 'SHAKE_SURPRISE'
  | 'SHARE'
  | 'CONTINUE_LISTENING'
  | 'PIN'
  | 'UNPIN'
  | 'LIKE'
  | 'UNLIKE'
  | 'LOOP_ON'
  | 'SPEED_CHANGED'
  | 'SLEEP_TIMER_ON'
  | 'DELETE'
  | 'EMPTY_LIBRARY'
  | 'CUSTOM';

export interface TeddyReactionData {
  id: string;
  type: TeddyReactionType;
  message: string;
  priority: number;
  durationMs: number;
}

const REACTION_PRIORITIES: Record<TeddyReactionType, number> = {
  RECORDING_SAVED: 10,
  TAKE_AGAIN: 9,
  TEDDY_PICK: 8,
  SHAKE_SURPRISE: 8,
  EMPTY_LIBRARY: 8,
  SHARE: 7,
  CONTINUE_LISTENING: 6,
  PIN: 5,
  UNPIN: 5,
  LIKE: 4,
  UNLIKE: 4,
  LOOP_ON: 3,
  SPEED_CHANGED: 2,
  SLEEP_TIMER_ON: 2,
  DELETE: 1,
  CUSTOM: 5,
};

const DEFAULT_DURATION_MS = 3000;
const GLOBAL_COOLDOWN_MS = 2500;

// Curated quote banks (warm, cute, intentional, never childish, not overly verbose)
const REACTION_QUOTES: Record<TeddyReactionType, string[]> = {
  RECORDING_SAVED: [
    'That sounded lovely! 🧸❤️',
    'Saved safely, just for you. ❤️',
    'Teddy tucked it away! 🧸',
    'Captured beautifully. 🎙️🧸',
  ],
  TAKE_AGAIN: [
    "Let's try another take! 🎙️",
    'Ready when you are! 🧸✨',
    'Practice makes magic. 🎙️🧸',
  ],
  TEDDY_PICK: [
    'I picked this one for you. 🧸❤️',
    "Here's a special one from your library! ✨",
    'Teddy chose this keepsake for you. 🧸',
  ],
  SHAKE_SURPRISE: [
    'Whoa! Teddy felt that! 🧸✨',
    'Surprise! I found something for you. ❤️',
    'A little shake, a little keepsake! 🧸🎁',
  ],
  SHARE: [
    'Off it goes! 📤🧸',
    'Shared with love. 🧸❤️',
    'Sending your voice out into the world! ✨',
  ],
  CONTINUE_LISTENING: [
    'Welcome back to this one! 🧸',
    'Picking up right where we left off. ✨',
  ],
  PIN: [
    "I'll keep this one close. 📌❤️",
    'Pinned right at the top! 📌🧸',
  ],
  UNPIN: [
    "Okay, I'll let this one roam free. 🧸",
    'Unpinned from the top. 🧸',
  ],
  LIKE: [
    'Good choice. ❤️',
    'Added to your favorites! 💖',
    'A lovely keepsake. 🧸❤️',
  ],
  UNLIKE: [
    'Removed from favorites. 🧸',
  ],
  LOOP_ON: [
    "Again? I don't mind. 🔁🧸",
    'Looping your keepsake! 🔁✨',
  ],
  SPEED_CHANGED: [
    'Speedy Teddy mode! ⚡🧸',
    'Adjusted the tempo! 🧸',
  ],
  SLEEP_TIMER_ON: [
    "Rest easy. I'll stop when it's time. 🌙🧸",
    'Sweet dreams ahead. 🌙🧸',
  ],
  DELETE: [
    'Okay... Teddy let it go. 🧸',
  ],
  EMPTY_LIBRARY: [
    'Teddy needs a voice note first! 🎙️🧸',
  ],
  CUSTOM: [
    'Teddy is listening! 🧸',
  ],
};

class TeddyReactionManager {
  private currentReaction: TeddyReactionData | null = null;
  private lastReactionTime: number = 0;
  private lastReactionType: TeddyReactionType | null = null;
  private isRecordingActive: boolean = false;

  /**
   * Updates recording state to suppress reactions during recording sessions.
   */
  setRecordingActive(active: boolean) {
    this.isRecordingActive = active;
    if (active) {
      this.clearCurrentReaction();
    }
  }

  /**
   * Triggers a reaction with priority and cooldown validation.
   */
  async trigger(type: TeddyReactionType, customText?: string): Promise<boolean> {
    // 1. Never show reactions during active recording
    if (this.isRecordingActive) {
      return false;
    }

    const now = Date.now();
    const priority = REACTION_PRIORITIES[type] ?? 5;

    // 2. Repetitive action suppression (e.g. rapid like/unlike)
    if (this.lastReactionType === type && now - this.lastReactionTime < GLOBAL_COOLDOWN_MS) {
      return false;
    }

    // 3. Priority & cooldown check against currently visible reaction
    if (this.currentReaction) {
      if (priority <= this.currentReaction.priority) {
        // Lower or equal priority cannot override an active higher-priority reaction
        return false;
      }
    } else if (now - this.lastReactionTime < GLOBAL_COOLDOWN_MS && priority < 8) {
      // Minor actions must wait for cooldown
      return false;
    }

    // 4. Select message text
    let message = customText?.trim();
    if (!message) {
      message = await this.selectMessage(type);
    }

    const reaction: TeddyReactionData = {
      id: 'react_' + now.toString(36) + Math.random().toString(36).substring(2, 6),
      type,
      message,
      priority,
      durationMs: DEFAULT_DURATION_MS,
    };

    this.currentReaction = reaction;
    this.lastReactionTime = now;
    this.lastReactionType = type;

    // 5. Emit reaction event
    DeviceEventEmitter.emit('teddy_reaction_show', reaction);
    return true;
  }

  /**
   * Clears the current reaction immediately.
   */
  clearCurrentReaction() {
    if (this.currentReaction) {
      this.currentReaction = null;
      DeviceEventEmitter.emit('teddy_reaction_clear');
    }
  }

  /**
   * Selects a quote variation, occasionally inserting user's name sparingly.
   */
  private async selectMessage(type: TeddyReactionType): Promise<string> {
    const quotes = REACTION_QUOTES[type] || ['Teddy loves this! 🧸'];
    let selected = quotes[Math.floor(Math.random() * quotes.length)];

    // Sparing personalization: ~25% chance on milestone reactions
    if (type === 'RECORDING_SAVED' || type === 'TEDDY_PICK') {
      try {
        const prefs = await preferencesService.getPreferences();
        const userName = prefs.userName?.trim();
        if (userName && Math.random() < 0.25) {
          if (type === 'RECORDING_SAVED') {
            return `Nice one, ${userName}! 🧸❤️`;
          } else if (type === 'TEDDY_PICK') {
            return `Found this for you, ${userName}! 🧸❤️`;
          }
        }
      } catch {}
    }

    return selected;
  }
}

export const teddyReactionService = new TeddyReactionManager();

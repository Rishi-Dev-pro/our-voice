import { vnRepository } from '@/database/repositories/vnRepository';
import { checkAudioFileExists } from './fileService';
import { preferencesService } from './preferencesService';
import { VN } from '@/types/vn';

export type TeddyPickResult =
  | { status: 'success'; vn: VN }
  | { status: 'empty' }
  | { status: 'no_valid_audio' };

export const teddyPickerService = {
  /**
   * Intentionally selects a voice note from the user's existing local library.
   * Excludes missing audio files, avoids currently playing track, and respects recent pick history.
   */
  async pickVoiceNote(currentPlayingId?: string | null): Promise<TeddyPickResult> {
    const allVns = await vnRepository.getAllVns();

    // 1. Empty library check
    if (!allVns || allVns.length === 0) {
      return { status: 'empty' };
    }

    // 2. Filter candidate list to only voice notes whose audio files physically exist
    const validVns = allVns.filter((vn) => {
      try {
        return checkAudioFileExists(vn.fileUri);
      } catch {
        return false;
      }
    });

    if (validVns.length === 0) {
      return { status: 'no_valid_audio' };
    }

    // 3. Single voice note edge case
    if (validVns.length === 1) {
      const single = validVns[0];
      await preferencesService.recordTeddyPick(single.id);
      return { status: 'success', vn: single };
    }

    // 4. Exclude currently playing track if there are alternatives
    let candidates = validVns;
    if (currentPlayingId && candidates.length > 1) {
      const nonPlaying = candidates.filter((v) => v.id !== currentPlayingId);
      if (nonPlaying.length > 0) {
        candidates = nonPlaying;
      }
    }

    // 5. Prefer voice notes not in recent pick history
    const recentPickIds = await preferencesService.getRecentTeddyPicks();
    const freshCandidates = candidates.filter((v) => !recentPickIds.includes(v.id));

    // If fresh candidates exist, use them; otherwise, reset to all candidates so small libraries aren't starved
    const selectionPool = freshCandidates.length > 0 ? freshCandidates : candidates;

    // 6. Weighted / Intentional selection:
    // Give slight priority boost to:
    // - Pinned or liked keepsakes
    // - VNs that haven't been played in a while
    const scoredPool: { vn: VN; weight: number }[] = selectionPool.map((vn) => {
      let weight = 1.0;
      if (vn.isPinned) weight += 0.8;
      if (vn.isLiked) weight += 0.5;
      if (vn.lastPosition && vn.lastPosition > 0) weight += 0.3;
      return { vn, weight };
    });

    const totalWeight = scoredPool.reduce((sum, item) => sum + item.weight, 0);
    let randomVal = Math.random() * totalWeight;

    let picked = scoredPool[0].vn;
    for (const item of scoredPool) {
      if (randomVal <= item.weight) {
        picked = item.vn;
        break;
      }
      randomVal -= item.weight;
    }

    // 7. Record pick in bounded history
    await preferencesService.recordTeddyPick(picked.id);

    return { status: 'success', vn: picked };
  },
};

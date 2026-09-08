## Spin the Bottle Capacitor Integration Plan

### Phase 1: Verify Web Implementation (Optional but Recommended)
1. Run `npm run dev` to test the game on web
2. Test these flows:
   - Join a game from CommunityScreen → SpinBottleLanding
   - Verify room appears with 12 seats
   - Test spinning the bottle
   - Test kiss responses (YES/NO)
   - Test chat functionality
   - Test leaving/room management

### Phase 2: Build for Capacitor
1. Build the Next.js app: `npm run build`
2. Sync with Capacitor Android: `npm run cap:sync android`
3. Verify the Android project structure is correct

### Phase 3: Test on Android Device/Emulator
1. Connect an Android device or start an emulator
2. Run the app: `npm run cap:run android`
3. Test all game flows on mobile:
   - Join from CommunityScreen
   - Verify touch/click interactions
   - Test haptics (if device supports)
   - Verify network connectivity

### Phase 4 (Optional - Future Enhancement): Enable Realtime
1. Integrate Supabase room channels into SpinBottleRoom
2. Replace polling with realtime broadcasts
3. Enhance sync reliability and reduce latency

**Timeline Estimate:**
- Phase 1: 30-60 minutes (quick smoke test)
- Phase 2: 10-15 minutes
- Phase 3: 30-60 minutes (including setup time)
- Phase 4: 2-4 hours (if pursued)

**Note**: Since the web version is already fully implemented, the primary work is testing and Capacitor wrapping. No significant code changes are required.
## M.I.K.U 1.20.0: steadier custom voice

- **The custom voice stays the same from sentence to sentence.** Before, the voice engine rolled a new random seed for every sentence, so the voice drifted and could sound like several different people. It now uses one fixed seed every time, like your original test script.
- **No more mixing voices within one reply.** If the custom voice isn't ready (for example, it's still loading after launch), the whole reply uses your other voice instead of switching back and forth. The next reply tries the custom voice again.

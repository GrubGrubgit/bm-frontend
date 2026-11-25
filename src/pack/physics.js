// 6.4f movement physics (headless-measured on stock bytes, Blaster Master USA).
//
// Coordinate system: player X position is the 16-bit pair (X_HI:X_LO) and
// tank Y position is (Y_HI_TANK:Y_LO_TANK), both in 1/16px subunits:
//   px = (HI * 256 + LO) / 16.
// The HI byte steps exactly when LO wraps (wrap-lockstep proven both modes).
//
// Method notes (see PLAN-EDITOR.md 6.4f): warp_raw(k) at frame 700, Start tap
// at frame 61, act no earlier than ~frame 860 (settle), HP ($40D) flat over
// every measurement window. OAM slots rotate/flicker every frame and enemy
// traffic crosses the tank pocket, so all proofs are RAM-only; OAM pixel
// agreement (+24/f == +1.5px/f) was confirmed by hand in the probes.
// Pad values used: Right=128 Left=64 Up=16 Down=32 A=1 Start=8.
export const SUBPX = 16;
export const ADDR = {
  X_LO: 0x402, X_HI: 0x403,     // player X lo/hi (Jason + tank share)
  Y_LO_TANK: 0x404, Y_HI_TANK: 0x405, // tank Y lo/hi; $404 doubles as Jason air Y-velocity (below)
  CAM_X: 0x28,                  // camera/scroll X (== $C9 twin); static inside deadzone
  JASON_Y: 0x7D,                // Jason screen Y, px, down-positive
  HP: 0x40D, AREA: 0x14,
};
// Total X in subunits, and in pixels.
export function xSub(hi, lo) { return hi * 256 + lo; }
export function xPx(hi, lo) { return (hi * 256 + lo) / SUBPX; }
// Jason on-foot run (dungeon areas, warp_raw(8) pocket). Symmetric L/R.
// Motion starts ~2 frames after input; wall contact pins the sprite while
// RAM keeps accumulating, and release-while-pinned shows a strange decay
// (fast drop, ~10/f plateau, then clean stop) -- only clean-air runs feed
// these constants.
export const JASON_RUN = {
  ACCEL: 2,     // subunits/frame^2 (|v| ramps 2,4,...,24)
  VMAX: 24,     // subunits/frame (1.5 px/frame)
  FRICTION: 1,  // subunits/frame^2 on release (24,23,...,0)
  LATENCY: 2,   // frames from input edge to first motion
};
// Jason jump (standstill A-tap): $7D arc 147->100->147 (~40f air).
// $404 in Jason mode is air vertical VELOCITY, offset-binary (REST = 0):
// takeoff ~VY0, then exactly +GRAVITY/frame, back to REST on landing.
// Apex hover: velocity freezes exactly one frame (...,146,146,148,...) during
// the $7D=100 plateau, then resumes +2/frame; landing snaps to REST mid-ramp.
// NOTE (open, 6.4f-followup): naive integration of this velocity predicts
// ~64px of rise vs the observed 47px -- there is an extra factor ~0.7 in
// how $404 feeds $7D. The ramp shape (+2/frame exact) and endpoints are
// exact; only the $404->pixel gain is unmodeled. Not asserted numerically.
export const JASON_JUMP = {
  Y0: 147, APEX: 100,   // $7D screen-Y endpoints of a flat jump
  VY0: -64, GRAVITY: 2, REST: 128, // $404 velocity units/frame(^2)
};
// Sophia tank (overhead areas, warp_raw(0) pocket). NO ramp, NO friction:
// velocity = held-direction * VMAX within ~1 frame, 0 within ~1 frame of
// release. Ceiling/floor contact zeroes Y velocity while held
// (observed -24,-8,0 across 2 frames on ceiling contact).
export const TANK = {
  VMAX: 24, // subunits/frame on X and Y (1.5 px/frame); Up=-24 Down=+24
};
// Deliberately NOT modeled (measured, but role unclear -- see PLAN 6.4f):
// $7C (124): flat 140 across a running jump after reading 100->140 across a
//   standstill jump -- refutes the early "air timer" guess, true role open.
// $405 (1029) in Jason mode: drifts 59->56->60 across a jump; not Y-hi.
// $408 (1032): steps during X runs but breaks correct-scale constancy;
//   camera-adjacent, not player X-hi (X-hi is $403 by wrap-lockstep).

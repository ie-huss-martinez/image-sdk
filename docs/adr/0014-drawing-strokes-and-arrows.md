# 0014. Drawing: how strokes are simplified, stored and drawn, and the arrow's shape

- **Status:** Accepted
- **Date:** 2026-11-17
- **Amended:** 2026-11-17, as the renderer was built: runs that meet are drawn as one path, so a cut is exactly invisible, under "How a stroke is drawn"
- **Amended:** 2026-11-17, as the model was built: which refusals are the schema's, `too-many-strokes`, and the exact sample count of 64 runs
- **Amends:** [ADR 0009](0009-scene-space-layers-and-plan-versions.md), only in the form of a stroke: it holds `runs` of points, not one list of `points`
- **Builds on:** [ADR 0009](0009-scene-space-layers-and-plan-versions.md) (the `drawing` and `arrow` kinds, their commands, format version 3 and `maxDrawingPoints`), [ADR 0007](0007-editor-shell.md) (gestures as transient plans) and [ADR 0010](0010-redaction.md) (redactions cover what's drawn)

## Context

[ADR 0009](0009-scene-space-layers-and-plan-versions.md) decided what 0.5.0 adds to the plan: a `drawing` layer that holds strokes, an `arrow` layer, `image.addStrokes` and `image.removeStrokes`, format version 3, and a limit on points. It left four things as "a fixed algorithm" or unsaid, and each must be exact before there's a schema, a reducer or a vector:

- **How a stroke is simplified.** A pointer reports hundreds of samples a second. The plan can't hold them all, and the vectors must pin which ones it keeps.
- **What happens at the ceiling** of 2,000 points in a stroke, when someone keeps drawing, and how what they drew stays one thing to undo and to remove.
- **How a stroke and an arrow are drawn,** so the preview, every export and another implementation of the format agree on the shape.
- **What the edge cases are:** a stroke with one point, an arrow from a point to itself, a drawing with no strokes.

A prototype of the simplifier was timed before this was written, in Node 26 on the development machine. The numbers are in the decision they changed.

## Decision

### What the plan holds

A `drawing` layer and an `arrow` layer have the common fields of every layer: `key`, `name`, `visible` and `opacity` ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). Neither has a box or a rotation.

**`drawing`:**

| Field | Value |
|---|---|
| `x`, `y` | Its origin, in whole scene pixels |
| `strokes` | 1 to 1,024 strokes, in the order they're drawn |

**A stroke:**

| Field | Value |
|---|---|
| `colour` | `#rrggbb` |
| `width` | 1 to 1,024 whole pixels, the limit a shape's stroke has |
| `runs` | 1 to 64 runs. Each is `[x0, y0, x1, y1, …]`: 1 to 2,000 points, in whole pixels from the drawing's origin |

**`arrow`:**

| Field | Value |
|---|---|
| `from`, `to` | Each `{ x, y }`, in whole scene pixels: the tail and the tip |
| `colour` | `#rrggbb` |
| `width` | 1 to 1,024 whole pixels: the shaft's width |

- **A stroke is what one gesture drew,** from the press to the release, however long. It's the unit everywhere: one stroke in one command, one undo step, one thing to remove.
- **A run is a part of a stroke,** a polyline of at most 2,000 points. A stroke has several only when it's long: the simplifier cuts it, as below. Runs aren't separate marks: they have their stroke's colour and width, and no command adds, removes or reorders a run.
- **The format doesn't require a run to start where the last one ended.** The simplifier's runs do. A reader draws each run as it is, so there's no rule between runs to check or to break.
- **A stroke may be one run of one point.** It's a dot: a tap with the pen.
- **Every coordinate is within 65,536 of the scene's origin,** as a layer's box is: a drawing's origin, and its origin plus each point.
- **A drawing has at least one stroke.** One with none would be a layer that draws nothing and can't be found on the image. `image.removeStrokes` that would leave none is refused; removing the layer is `image.removeLayers`.
- **An arrow's ends differ.** One from a point to itself has no direction.
- **`image.updateLayers` sets** a drawing's `x` and `y`, and an arrow's `from`, `to`, `colour` and `width`, with the common fields. Strokes change only through the stroke commands, so an undo step holds the strokes it removed and no others.

**Rejections,** by the rule that what a schema can see is `malformed-command` and what depends on the plan has its own reason:

| Reason | When |
|---|---|
| `invalid-points` | A run with an odd number of coordinates, or a point outside the scene's coordinates once the drawing's origin is added. A schema can't state either. A drawing's origin or an arrow's end outside the scene is the schema's to refuse, so it's `malformed-command`, as a box's place is `invalid-box` |
| `too-many-strokes` | `image.addStrokes` that would leave a drawing with more than 1,024 |
| `empty-drawing` | A drawing with no strokes, or a removal that would leave none |
| `empty-arrow` | `from` equals `to` |
| `wrong-kind` | A stroke command on a layer that isn't a drawing, as today for another kind's field |
| `invalid-index` | `image.removeStrokes` with an index the drawing doesn't have, or one twice |

`TOO_MANY_POINTS` is the limit's own error code, from `maxDrawingPoints` ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)).

### Simplifying a stroke

`simplifyStroke(points, tolerance)` is in the core: pure, with no canvas and no clock, and in the conformance vectors. It takes the pointer's samples, already in whole pixels from the drawing's origin, and a tolerance in whole scene pixels, and returns one stroke's `runs`.

1. **Repeats go.** A point equal to the one before it is dropped.
2. **Long input is cut into runs** of at most 2,000 points. Each run starts on the last point of the one before, so the runs join.
3. **Each run is simplified by Ramer–Douglas–Peucker:** its first and last points are kept; between two kept points, the point farthest from the segment that joins them is kept if it's farther than the tolerance, and each side is treated the same way.

The details that make it exact:

- **Distance is to the segment, not to the line through it.** A point beyond an end is as far as it is from that end. A stroke that doubles back keeps its turn.
- **Distances are compared as whole numbers, never as roots or quotients.** For a segment of squared length `L`, a point's measure is its squared cross product when it projects inside the segment, and its squared distance to the nearer end times `L` otherwise. It's kept when that exceeds `tolerance² × L`. When the two kept points are equal, a closed loop, the measure is the squared distance to that point, against `tolerance²`.
- **The products need more than a double holds.** Coordinates span up to 2¹⁷, so a squared cross product reaches 2⁷⁰. The comparison uses `BigInt`; every other step is exact in doubles. So the same input gives the same points in every engine and in any other implementation.
- **Among points equally far, the first is taken.**
- **A tolerance of 0** drops only repeats and points exactly on a segment.
- **It doesn't recurse:** it keeps its own stack, so input can't exhaust the call stack.

**Why the input is cut, and not simplified harder.** The first design kept one stroke: simplify, and if more than 2,000 points remain, double the tolerance and try again. Measured:

| Input | Points kept | Time |
|---|---|---|
| A hand-like scribble of 4,000 samples, tolerance 1 | 761 | 1.3 ms |
| The same, 20,000 samples | 3,747 | 23 ms |
| A zigzag of 4,000 points, every one a turn | 4,000 | 175 ms |
| The same, 20,000 points | 20,000 | 5.7 s |
| The zigzag of 4,000, doubling the tolerance until it fits | 2 | 1.4 s, in 7 passes |

- **The algorithm is quadratic when nothing can go,** and doubling repeats that cost and then flattens a stroke to a line: the zigzag became its two ends.
- **Cut into runs of 2,000, the worst case is one run's:** 58 to 73 ms measured for 2,000 turns, against 1 ms for a hand-like run, and a run never needs a second pass, because simplifying only removes points.
- **A cut can't be seen.** A run that starts where the one before it ended is drawn as the same path, joined there, so a stroke that was cut is drawn as the one line it is: the same pixels as uncut, in every engine. See "How a stroke is drawn".
- **A cut can't be felt either.** The runs stay inside one stroke, so undo and "remove the last stroke" act on all that was drawn, never on its last part.
- **64 runs is the stroke's ceiling,** fixed in the schema: 127,937 samples before simplifying, since each run after the first starts on the last point of the one before. That's many minutes of drawing without lifting. There the draw tool ends the stroke and starts another, the one case where a gesture is two strokes. `simplifyStroke` given more than that throws a `RangeError`: it's a caller's mistake, not a file's.

**The tolerance is the tool's choice, not the format's.** The draw tool passes one screen pixel in scene pixels, rounded, and at least 1: a detail smaller than a screen pixel wasn't drawn on purpose. The vectors use several tolerances.

**The vectors** include: a run of collinear points, which keeps its ends; repeated points; a single point; two equal points, which is one; a closed loop; a stroke that doubles back along itself; ties; a tolerance of 0; coordinates at the scene's limits, where a double would round; and strokes of 2,000, 2,001 and 4,500 samples, which are one stroke of one, two and three runs.

### How a stroke is drawn

- **Each run is a polyline through its points,** in the stroke's colour, at its width, with round joins and round ends, drawn through the scene's transform to the output ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). A run of one point is a disc as wide as the stroke.
- **A run that starts on the last point of the run before it continues that run's path,** with a round join where they meet, as within a run. Measured before this was decided: two runs drawn apart, each with its own round ends, weren't quite the one line. At a 12-pixel stroke's corner, 10 to 19 pixels differed by more than an eighth of full scale in Chromium, Firefox and WebKit, and 7 by more than a quarter in WebKit, where the two ends' antialiasing overlaps. Drawn as one path they differ by nothing. A run that starts anywhere else is its own line, with its own ends; a run of one point on the end of a line adds nothing to it.
- **No curve is fitted.** A simplified stroke keeps a point where the hand turned, and a curve through sparse points would round a drawn corner and bulge between far points. At a tolerance of one screen pixel, a polyline with round joins already looks like what was drawn.
- **Pressure, tilt and speed aren't recorded.** A stroke has one width. A pen, a finger and a mouse draw the same.
- **A drawing is composited as a group:** its strokes are drawn opaque into the scratch canvas, which is then composited at the layer's opacity ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). So strokes that cross don't darken where they meet. A highlighter is a wide stroke in a drawing whose opacity is low.
- **Strokes aren't developed,** as no layer is, and **redactions cover them:** they're geometry drawn at the output's size, with no pixels to sanitise, and the redactions' final pass is drawn over them ([ADR 0010](0010-redaction.md)).

### The arrow's shape

`arrowOutline(from, to, width)` is in the core, pure and in the vectors. It returns seven points, a polygon the renderer fills in the arrow's colour:

- **The head** is a triangle with its tip exactly on `to`. It's `4 × width` long and `4 × width` across at its base.
- **The shaft** is a rectangle `width` across, from `from` to the middle of the head's base. Its tail is square.
- **An arrow shorter than its head is all head:** the triangle keeps its proportions, as long as the arrow, with its base centred on `from`. The outline still has seven points, the shaft's four at the base, so its form never changes.
- **It's filled, not stroked,** so nothing is drawn beyond the tip, and the tip is where the arrow points.
- **The vectors** state the outline for arrows along each axis, at a diagonal, shorter than the head, and at the scene's limits, with a tolerance of 10⁻⁹ (sdk-core ADR 0045), since it divides by the arrow's length.

### Bounds

`drawingBounds` and `arrowBounds` are in the core: the smallest whole-pixel rectangle of the scene that holds everything the layer draws, from its points and widths. The editor places a drawing's and an arrow's frame with them, and the renderer may skip a layer wholly outside the crop.

### Limits

As [ADR 0009](0009-scene-space-layers-and-plan-versions.md) set them, restated where they meet this record:

- **In the schema, fixed:** 2,000 points in a run, 64 runs in a stroke and 1,024 strokes in a drawing.
- **In the file policy:** `maxDrawingPoints`, 200,000 points across a plan's drawings with a warning at 100,000, checked on each command that adds strokes or a drawing, and when a plan is applied.
- **In the history:** the session counts the points its steps hold, and trims the oldest steps above 1,000,000.

### In the editor

Decided here because they fix which commands the tools build. Their controls and keys are for their own pull requests, with [ADR 0013](0013-layers-in-the-editor.md)'s frames.

- **A stroke in progress is a transient plan** ([ADR 0007](0007-editor-shell.md)): the same `simplifyStroke`, with the same tolerance, on every move. So the preview while drawing is exactly what the release commits, and nothing shifts when the pointer lifts. A run that's full no longer changes, so the tool keeps its result and simplifies only the last run: about a millisecond a move for a hand's stroke.
- **One gesture is one stroke, one command and one undo step,** however many runs it has: `image.addStrokes` with that stroke, whose inverse removes it whole.
- **"Remove the last stroke" removes the last gesture:** `image.removeStrokes` with the last stroke's index. Nothing in the editor names a run.
- **A stroke joins the selected drawing** when that drawing has the opacity the tool draws with: `image.addStrokes`. Otherwise it starts a new drawing over every layer: `image.insertLayers`, with the stroke in it. So a pen and a highlighter never share a drawing, and a signature is one layer.
- **The pointer's coalesced samples are used where the browser has them.** They change how many samples reach the simplifier, not what it does.
- **There's no eraser.** A stroke is removed whole, the last one first, with `image.removeStrokes`.
- **Freehand drawing needs a pointer** ([ADR 0009](0009-scene-space-layers-and-plan-versions.md), WCAG 2.5.7's essential exception). The arrow has a keyboard way: its tool's button inserts one at the centre of the view, and its two ends move with the frames' keys.

## Alternatives considered

- **Dropping points closer than the tolerance to the last one kept:** linear and exact in doubles, but a straight line drawn slowly keeps a point every few pixels, and a long stroke reaches the ceiling for no gain in shape.
- **Ramer–Douglas–Peucker with floating-point distances:** shorter, but whether a point is kept can turn on the last bit of a root, which differs between implementations, and a vector can't give a tolerance for a decision.
- **Splitting the products into halves to stay in doubles:** exact too, but it's our own big-number arithmetic where the language has one.
- **Doubling the tolerance until a stroke fits:** measured above: slow in the worst case, and it flattens the stroke.
- **A higher ceiling than 2,000 points in one list:** the simplifier's worst case grows with the square of what it's given at once.
- **Long gestures as several strokes, grouped by a gesture's id on each:** flat, but the group is then a rule across strokes that every command must keep: ids contiguous, a removal taking a whole group, an inverse restoring one. Each is a rejection to specify and a way for a document to be wrong.
- **A flag on a stroke that it continues the one before:** the same rules in another form, plus one for the first stroke.
- **Inserting a gesture's strokes in one command, and nothing in the plan:** undo would be right, but once another stroke is drawn nothing says which strokes were one gesture, so "remove the last stroke" couldn't.
- **Fitting curves, and storing their control points:** smoother at a large size, but a second primitive in the format, and the fit is one more algorithm to pin.
- **An arrow as a stroked line with a stroked head:** the joins and ends would reach past the tip by half the width, so the arrow would point beside what it was aimed at.
- **A zero-length arrow drawn as a dot:** it's a different mark, which a one-point stroke already is.

## Consequences

- **The same samples give the same strokes everywhere,** and the vectors can say so exactly.
- **The core gains `BigInt` arithmetic,** which every supported browser has; it's the simplifier's only use of it.
- **A stroke's cost is bounded:** at most 2,000 points, and about 70 ms to simplify a run in the worst case.
- **A stroke is always what was drawn.** A long one has several runs, which nobody sees, and it's undone and removed whole.
- **A stroke's points are nested one level,** runs inside strokes, where ADR 0009 sketched one flat list. Drawing isn't released, so no document changes.
- **Drawn lines aren't smoothed.** At high zoom a stroke shows its segments, on the whole-pixel grid the plan holds.
- **The server-safe entry grows** by the model's checks, the simplifier, the outline and the bounds. Its budget is revisited in the pull request that adds them, from the measurement.

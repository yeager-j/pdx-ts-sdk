# Situation

A situation is a progressing scripted context with an approach and target. Scripts can change its
progress, approach, target, lock state, and permanent or timed flags. It provides a stateful frame
for stories and mechanics that develop over time rather than resolve in one event.

## Common entry points

Common entry points include `situation_event` bodies and callbacks from generated situation
operations.

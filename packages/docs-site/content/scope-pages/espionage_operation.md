# Espionage operation

An espionage operation is an active covert-operation context. Scripts can add information, assign
or unassign assets, finish a stage, lock progress, and store operation flags. It carries the staged
state of clandestine work against a target rather than the spy network's overall strength.

## Common entry points

Common entry points include `espionage_operation_event` bodies and typed operation callbacks that
supply an `EspionageOperationScope`.

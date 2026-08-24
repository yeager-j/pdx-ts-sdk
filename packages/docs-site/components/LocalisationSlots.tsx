import type { ContentLocalisation } from "@pdx-ts/sdk/reference";

/**
 * One localisation-slot table — shared by the registry's own slots and each
 * repeated-struct entry's, so the two render a slot identically: the
 * authoring member, the key pattern, and requiredness including the
 * "required unless <member> is set" conditional form.
 */
export function LocalisationSlots({ slots }: { slots: readonly ContentLocalisation[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Member</th>
          <th>Key pattern</th>
          <th>Required</th>
        </tr>
      </thead>
      <tbody>
        {slots.map((slot) => (
          <tr key={slot.member}>
            <td>
              <code>{slot.member}</code>
            </td>
            <td>
              <code>{slot.pattern}</code>
            </td>
            <td>
              {slot.required ? (
                "yes"
              ) : slot.requiredUnless !== undefined ? (
                <>
                  unless <code>{slot.requiredUnless}</code> is set
                </>
              ) : (
                "no"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { cleanList } from '../../lib/transparency';

/** Goals and limits the model assumed for a fictional proxy. Rendered as plain list text. */
export function ProxyAssumptions({
  goals,
  constraints,
}: {
  goals?: string[] | null;
  constraints?: string[] | null;
}) {
  const goalItems = cleanList(goals);
  const constraintItems = cleanList(constraints);
  if (!goalItems.length && !constraintItems.length) return null;
  return (
    <div className="proxy-assumptions">
      <p className="proxy-assumptions-note">Assumed by the model for this fictional proxy</p>
      {goalItems.length > 0 && (
        <>
          <h4>Goals</h4>
          <ul>
            {goalItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {constraintItems.length > 0 && (
        <>
          <h4>Constraints</h4>
          <ul>
            {constraintItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

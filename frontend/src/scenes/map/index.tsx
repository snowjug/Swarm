import { useWorkspace } from '../../app/context';
import { ConstraintsScene } from './constraints';
import { MapScene } from './MapScene';

/** The Map has one more view than the picture and the list: the constraints on the decision. */
export default function MapEntry() {
  const { view } = useWorkspace();
  return view === 'constraints' ? <ConstraintsScene /> : <MapScene />;
}

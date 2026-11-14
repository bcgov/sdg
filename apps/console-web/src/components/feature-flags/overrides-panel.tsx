import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { Text } from '@repo/design-system/components/text';
import { type Ref, useCallback, useState } from 'react';

import type { FlagDetail, FlagOverride, Person } from '../../api/feature-flags';
import { KIND_LABELS, onOff, people } from './labels';
import { PeopleSearch } from './people-search';
import type { DetailActions } from './use-detail-actions';

import styles from './feature-flags.module.css';

type OverrideActions = Pick<DetailActions, 'setOverride' | 'isSettingOverride' | 'removeOverride' | 'busyPrincipal'>;

function OverrideRow({ override, actions }: Readonly<{ override: FlagOverride; actions: OverrideActions }>) {
  const { removeOverride, busyPrincipal } = actions;
  const remove = useCallback(() => removeOverride(override), [override, removeOverride]);
  return (
    <tr>
      <th scope="row">{override.name}</th>
      <td>{override.email ?? ''}</td>
      <td>{KIND_LABELS[override.kind]}</td>
      <td>{onOff(override.enabled)}</td>
      <td>
        <Button
          size="small"
          variant="secondary"
          aria-label={`Remove the override for ${override.name}`}
          isPending={busyPrincipal === override.principalId}
          onPress={remove}
        >
          Remove
        </Button>
      </td>
    </tr>
  );
}

function OverrideTable({ flag, actions }: Readonly<{ flag: FlagDetail; actions: OverrideActions }>) {
  if (flag.overrides.length === 0) return <Text elementType="p">No one has an override for {flag.key}.</Text>;
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <caption>People {flag.key} is forced on or off for, whatever its switch and rollout</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Kind</th>
            <th scope="col">Override</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {flag.overrides.map((override) => (
            <OverrideRow key={override.principalId} override={override} actions={actions} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ChosenProps {
  flagKey: string;
  person: Person;
  actions: OverrideActions;
  onDone: () => void;
}

/** The person picked from the search: turn the flag on or off for them. */
function ChosenPerson({ flagKey, person, actions, onDone }: Readonly<ChosenProps>) {
  const { setOverride, isSettingOverride } = actions;
  const turnOn = useCallback(() => setOverride(person, true, onDone), [person, setOverride, onDone]);
  const turnOff = useCallback(() => setOverride(person, false, onDone), [person, setOverride, onDone]);
  return (
    <div className={styles.search}>
      <Text elementType="p">
        Set an override of {flagKey} for {person.displayName} ({KIND_LABELS[person.kind]}).
      </Text>
      <div className={styles.actions}>
        <Button isPending={isSettingOverride} onPress={turnOn}>
          Turn on for {person.displayName}
        </Button>
        <Button variant="secondary" isPending={isSettingOverride} onPress={turnOff}>
          Turn off for {person.displayName}
        </Button>
        <Button variant="tertiary" isDisabled={isSettingOverride} onPress={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface OverridesPanelProps {
  flag: FlagDetail;
  actions: OverrideActions;
  /** The R21 notice's link moves focus here. */
  sectionRef: Ref<HTMLElement>;
}

/** Who the flag is forced on or off for, and the search to add or change one (R18). */
export function OverridesPanel({ flag, actions, sectionRef }: Readonly<OverridesPanelProps>) {
  const [chosen, setChosen] = useState<Person | null>(null);
  const clear = useCallback(() => setChosen(null), []);
  return (
    <section ref={sectionRef} tabIndex={-1} className={styles.panel} aria-labelledby="overrides-heading">
      <Heading level={2} id="overrides-heading">
        Overrides
      </Heading>
      <Text elementType="p">
        Forced on for {people(flag.overrideCounts.on)} and off for {people(flag.overrideCounts.off)}.
      </Text>
      <OverrideTable flag={flag} actions={actions} />
      <Heading level={3}>Add or change an override</Heading>
      <PeopleSearch audience={flag.audience} onChoose={setChosen} />
      {chosen && <ChosenPerson flagKey={flag.key} person={chosen} actions={actions} onDone={clear} />}
    </section>
  );
}

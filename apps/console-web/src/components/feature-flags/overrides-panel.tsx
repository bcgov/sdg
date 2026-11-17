import { Button } from '@repo/design-system/components/button';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useState } from 'react';

import type { FlagDetail, Person } from '../../api/feature-flags';
import { FormDialog } from './form-dialog';
import { KIND_LABELS } from './labels';
import { OverridesTable } from './overrides-table';
import { PeopleSearch } from './people-search';
import type { DetailActions } from './use-detail-actions';

import styles from './feature-flags.module.css';

type OverrideActions = Pick<DetailActions, 'setOverride' | 'isSettingOverride' | 'removeOverride' | 'busyPrincipal'>;

interface ChosenProps {
  flagKey: string;
  person: Person;
  actions: OverrideActions;
  onSet: () => void;
  onChooseAgain: () => void;
}

/** The person picked from the search: turn the flag on or off for them, or go back to the search. */
function ChosenPerson({ flagKey, person, actions, onSet, onChooseAgain }: Readonly<ChosenProps>) {
  const { setOverride, isSettingOverride } = actions;
  const turnOn = useCallback(() => setOverride(person, true, onSet), [person, setOverride, onSet]);
  const turnOff = useCallback(() => setOverride(person, false, onSet), [person, setOverride, onSet]);
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
        <Button variant="tertiary" isDisabled={isSettingOverride} onPress={onChooseAgain}>
          Choose someone else
        </Button>
      </div>
    </div>
  );
}

interface OverrideDialogProps {
  flag: FlagDetail;
  actions: OverrideActions;
  isOpen: boolean;
  onClose: () => void;
}

/** The people search, then the on or off choice for the person picked; a set override closes the dialog. */
function OverrideDialog({ flag, actions, isOpen, onClose }: Readonly<OverrideDialogProps>) {
  const [chosen, setChosen] = useState<Person | null>(null);
  const chooseAgain = useCallback(() => setChosen(null), []);
  const close = useCallback(() => {
    setChosen(null);
    onClose();
  }, [onClose]);
  return (
    <FormDialog title="Add or change an override" isOpen={isOpen} isPending={actions.isSettingOverride} onClose={close}>
      {chosen ? (
        <ChosenPerson flagKey={flag.key} person={chosen} actions={actions} onSet={close} onChooseAgain={chooseAgain} />
      ) : (
        <>
          <PeopleSearch audience={flag.audience} onChoose={setChosen} />
          <div className={styles.actions}>
            <Button variant="secondary" onPress={close}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </FormDialog>
  );
}

interface OverridesPanelProps {
  flag: FlagDetail;
  actions: OverrideActions;
}

/**
 * Who the flag is forced on or off for, and a dialog to add or change one (R18); its tab names it. While the flag is
 * off, its overrides wait for the switch (kill switch), and the panel says so.
 */
export function OverridesPanel({ flag, actions }: Readonly<OverridesPanelProps>) {
  const [isAdding, setAdding] = useState(false);
  const open = useCallback(() => setAdding(true), []);
  const close = useCallback(() => setAdding(false), []);
  return (
    <section className={styles.tabSection} aria-label="Overrides">
      {!flag.enabled && flag.overrideCounts.on + flag.overrideCounts.off > 0 && (
        <InlineAlert
          variant="info"
          description={`${flag.key} is off, so its overrides have no effect until it’s turned on.`}
        />
      )}
      <div className={styles.endAction}>
        <Button size="small" onPress={open}>
          Add or change an override
        </Button>
      </div>
      <OverridesTable flag={flag} actions={actions} />
      <OverrideDialog flag={flag} actions={actions} isOpen={isAdding} onClose={close} />
    </section>
  );
}

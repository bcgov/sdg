import { Button } from '@repo/design-system/components/button';
import { Card } from '@repo/design-system/components/card';
import { Heading } from '@repo/design-system/components/heading';
import { FontAwesomeIcon, faCircleQuestion, faFileLines } from '@repo/design-system/icons';
import { createFileRoute } from '@tanstack/react-router';

import { Link } from '../../components/link';

import styles from './dev.module.css';

export const Route = createFileRoute('/dev/card')({
  component: CardPage,
});

const cardLayouts = [
  { name: 'Default', centered: false },
  { name: 'Centered', centered: true },
] as const;

const fileIcon = <FontAwesomeIcon icon={faFileLines} />;
const helpIcon = <FontAwesomeIcon icon={faCircleQuestion} />;
const helpLink = <Link to="/help" />;
const cardButtons = (
  <>
    <Button variant="primary" size="small">
      Start
    </Button>
    <Button variant="secondary" size="small">
      Save for later
    </Button>
  </>
);

function CardPage() {
  return (
    <>
      <Heading level={1}>Card</Heading>
      {cardLayouts.map(({ name, centered }) => (
        <section key={name} aria-labelledby={`card-${name}-heading`}>
          <Heading level={2} id={`card-${name}-heading`}>
            {name}
          </Heading>
          <div className={styles['cardGrid']}>
            <Card title="Static card" centered={centered} description="A title and a description." />
            <Card
              title="With icon and body"
              centered={centered}
              icon={fileIcon}
              description="A short summary of the item."
            >
              <p>Free-form body content goes here: lists, details or tags.</p>
            </Card>
            <Card
              title="Linked card"
              centered={centered}
              icon={helpIcon}
              description="The whole card goes to the Help page; the buttons act on their own."
              linkElement={helpLink}
              buttons={cardButtons}
            />
          </div>
        </section>
      ))}
      <section aria-labelledby="card-column-heading">
        <Heading level={2} id="card-column-heading">
          Column
        </Heading>
        <div className={styles['rows']}>
          <Card
            title="Linked column card"
            column
            icon={helpIcon}
            description="Full width, with the icon on the left and the content stacked beside it."
            linkElement={helpLink}
            buttons={cardButtons}
          >
            <p>Free-form body content.</p>
          </Card>
          <Card title="Column card without an icon" column description="The content takes the full width." />
        </div>
      </section>
    </>
  );
}

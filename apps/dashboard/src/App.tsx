import { Shell } from './components/Shell';
import { useRoute } from './lib/router';
import { DeadLetters } from './pages/DeadLetters';
import { Destinations } from './pages/Destinations';
import { EventDetail } from './pages/EventDetail';
import { Events } from './pages/Events';
import { Overview } from './pages/Overview';

export function App() {
  const route = useRoute();
  return (
    <Shell route={route}>
      {route.name === 'overview' && <Overview />}
      {route.name === 'events' && <Events filter={route.filter} />}
      {route.name === 'event' && <EventDetail key={route.id} id={route.id} />}
      {route.name === 'dead-letters' && <DeadLetters />}
      {route.name === 'destinations' && <Destinations />}
    </Shell>
  );
}

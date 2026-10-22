import { useSyncExternalStore } from 'react';

/** Hash routes are enough for a self-hosted admin served as static files. */
export type Route =
  | { name: 'overview' }
  | { name: 'events'; filter: 'all' | 'attention' | 'delivered' }
  | { name: 'event'; id: string }
  | { name: 'dead-letters' }
  | { name: 'destinations' };

export function parse(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'events': {
      if (parts[1]) return { name: 'event', id: parts[1] };
      const filter = params.get('filter');
      return {
        name: 'events',
        filter: filter === 'attention' || filter === 'delivered' ? filter : 'all',
      };
    }
    case 'dead-letters':
      return { name: 'dead-letters' };
    case 'destinations':
      return { name: 'destinations' };
    default:
      return { name: 'overview' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '#/';
    case 'events':
      return route.filter === 'all' ? '#/events' : `#/events?filter=${route.filter}`;
    case 'event':
      return `#/events/${route.id}`;
    case 'dead-letters':
      return '#/dead-letters';
    case 'destinations':
      return '#/destinations';
  }
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parse(hash);
}

export const navigate = (route: Route) => {
  window.location.hash = href(route);
};

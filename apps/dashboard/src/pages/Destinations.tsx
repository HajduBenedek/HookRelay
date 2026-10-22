import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Bar, Button, ErrorBlock, Mono, Panel } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatMs } from '../lib/format';

export function Destinations() {
  const queryClient = useQueryClient();
  const destinations = useQuery({ queryKey: ['destinations'], queryFn: api.destinations });
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sources });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.setEnabled(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  const sourceSlug = (id: string) => sources.data?.find((s) => s.id === id)?.slug ?? '—';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] leading-7 font-semibold">Destinations</h1>
        <p className="mt-1 text-[15px] text-muted">
          Where each source's webhooks are forwarded. A paused destination gets no new deliveries;
          its retries in progress continue.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Panel title="Forwarding to" flush>
            {destinations.isError ? (
              <ErrorBlock what="destinations" onRetry={() => destinations.refetch()} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="h-9 px-5 font-normal">Destination</th>
                      <th className="font-normal">Source</th>
                      <th className="px-3 text-right font-normal">Max attempts</th>
                      <th className="px-3 text-right font-normal">Timeout</th>
                      <th className="px-5 text-right font-normal">Forwarding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinations.isPending && (
                      <tr>
                        <td colSpan={5} className="h-14 px-5">
                          <Bar w="60%" />
                        </td>
                      </tr>
                    )}
                    {destinations.data?.map((d) => (
                      <tr key={d.id} className="border-t border-rule">
                        <td className="h-14 max-w-[280px] px-5">
                          <span className="block truncate font-medium">{d.name}</span>
                          <Mono small className="block truncate text-muted">
                            {d.url}
                          </Mono>
                        </td>
                        <td>
                          <Mono>/in/{sourceSlug(d.sourceId)}</Mono>
                        </td>
                        <td className="num px-3 text-right">{d.maxAttempts}</td>
                        <td className="num px-3 text-right">{formatMs(d.timeoutMs)}</td>
                        <td className="px-5 text-right">
                          <Switch
                            checked={d.enabled}
                            label={`Forward to ${d.name}`}
                            onChange={(enabled) => toggle.mutate({ id: d.id, enabled })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel
            title="Verifying a delivery in your receiver"
            aside={
              <a
                href="https://www.standardwebhooks.com/"
                target="_blank"
                rel="noreferrer"
                className="text-ink hover:underline"
              >
                Standard Webhooks spec
              </a>
            }
          >
            <p className="mb-3 max-w-[70ch] text-sm">
              Every request carries <Mono>webhook-id</Mono>, <Mono>webhook-timestamp</Mono> and{' '}
              <Mono>webhook-signature</Mono>. Check the signature over the raw body with the
              destination's secret, and use <Mono>webhook-id</Mono> to ignore a delivery you have
              already processed: retries and replays reuse it.
            </p>
            <pre className="overflow-x-auto rounded-control bg-raised p-4 font-mono text-xs leading-5">
              <code>{VERIFY_SNIPPET}</code>
            </pre>
          </Panel>
        </div>
        <AddDestination sources={sources.data ?? []} />
      </div>
    </div>
  );
}

const VERIFY_SNIPPET = `import { Webhook } from 'standardwebhooks';

const wh = new Webhook(process.env.HOOKRELAY_SECRET); // whsec_...

app.post('/webhooks', express.raw({ type: '*/*' }), async (req, res) => {
  let event;
  try {
    event = wh.verify(req.body, req.headers); // throws on a bad signature or old timestamp
  } catch {
    return res.status(401).end();
  }
  if (await alreadyProcessed(req.headers['webhook-id'])) return res.status(200).end();
  await handle(event);
  res.status(200).end(); // any 2xx counts as delivered; 5xx and 429 are retried
});`;

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${
        checked ? 'bg-positive' : 'bg-control'
      }`}
    >
      <span
        className={`size-4 rounded-full bg-surface transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

function AddDestination({ sources }: { sources: Array<{ id: string; slug: string }> }) {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const create = useMutation({
    mutationFn: api.createDestination,
    onSuccess: (d) => {
      setCreated({ name: d.name, secret: d.secret });
      queryClient.invalidateQueries({ queryKey: ['destinations'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      sourceId: String(form.get('sourceId')),
      name: String(form.get('name')),
      url: String(form.get('url')),
      maxAttempts: Number(form.get('maxAttempts')),
    });
  };

  const field = 'h-9 w-full rounded-control border border-control bg-surface px-3 text-sm';

  return (
    <Panel title="Add a destination">
      {created ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            <span className="font-medium">{created.name}</span> will receive new events. Give its
            receiver this signing secret. It is shown once.
          </p>
          <Mono className="block rounded-control bg-raised p-3 break-all">{created.secret}</Mono>
          <div>
            <Button onClick={() => setCreated(null)}>Add another</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Name
            <input
              name="name"
              required
              maxLength={100}
              className={field}
              placeholder="Orders service"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            URL
            <input
              name="url"
              type="url"
              required
              className={`${field} font-mono text-[13px]`}
              placeholder="https://orders.internal/webhooks"
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium">
              Source
              <select name="sourceId" required className={field}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    /in/{s.slug}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Max attempts
              <input
                name="maxAttempts"
                type="number"
                min={1}
                max={25}
                defaultValue={8}
                className={`${field} num`}
              />
            </label>
          </div>
          {create.error && (
            <p role="alert" className="text-sm text-negative">
              {create.error instanceof ApiError
                ? create.error.message
                : 'Could not save the destination.'}
            </p>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={create.isPending || sources.length === 0}
            >
              Add destination
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

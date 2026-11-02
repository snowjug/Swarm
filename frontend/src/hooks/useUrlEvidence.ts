import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isAbort } from '../api';
import { evidenceApi, type UrlEvidenceResult } from '../api/evidence';

export type UrlEvidenceStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Enter in the address field fetches the page. The field sits inside the entry form, so the key must
 * never be left to submit that form, which would build the whole project.
 */
export function fetchOnEnter(
  event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'preventDefault'>,
  canFetch: boolean,
  fetchPage: () => void,
): void {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  if (canFetch) fetchPage();
}

export interface UrlEvidenceState {
  address: string;
  status: UrlEvidenceStatus;
  result: UrlEvidenceResult | null;
  error: string | null;
  setAddress: (value: string) => void;
  /** Asks the server to fetch the page. Nothing is fetched in the browser. */
  fetchPage: () => void;
  /** Takes an address that was found elsewhere (in the question) and fetches it, as pressing Fetch would. */
  load: (value: string) => void;
  cancel: () => void;
  /** Forgets the page and the address. */
  discard: () => void;
}

/**
 * One page at a time: asking again cancels the request in flight, and leaving the page cancels it.
 * Nothing is asked of the server until the person asks.
 */
export function useUrlEvidence(): UrlEvidenceState {
  const [address, setAddressText] = useState('');
  const [status, setStatus] = useState<UrlEvidenceStatus>('idle');
  const [result, setResult] = useState<UrlEvidenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const setAddress = useCallback((value: string) => {
    setAddressText(value);
    setResult(null);
    setError(null);
    setStatus((old) => (old === 'loading' ? old : 'idle'));
  }, []);

  const run = useCallback((text: string) => {
    if (!text) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setStatus('loading');
    setError(null);
    setResult(null);
    void evidenceApi.fetchUrl(text, request.signal).then(
      (found) => {
        if (request.signal.aborted) return;
        setResult(found);
        setStatus('ready');
      },
      (failure: unknown) => {
        if (request.signal.aborted || isAbort(failure)) return;
        setError(errorMessage(failure));
        setStatus('error');
      },
    );
  }, []);

  const fetchPage = useCallback(() => run(address.trim()), [address, run]);
  const load = useCallback(
    (value: string) => {
      setAddressText(value);
      run(value.trim());
    },
    [run],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setStatus('idle');
  }, []);

  const discard = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setAddressText('');
    setResult(null);
    setError(null);
    setStatus('idle');
  }, []);

  return { address, status, result, error, setAddress, fetchPage, load, cancel, discard };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isAbort } from '../../api';
import { evidenceApi, type UrlEvidenceResult } from '../../api/evidence';

export type UrlEvidenceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UrlEvidenceState {
  address: string;
  status: UrlEvidenceStatus;
  result: UrlEvidenceResult | null;
  error: string | null;
  setAddress: (value: string) => void;
  /** Asks the server to fetch the page. Nothing is fetched in the browser. */
  fetchPage: () => void;
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

  const fetchPage = useCallback(() => {
    const text = address.trim();
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
  }, [address]);

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

  return { address, status, result, error, setAddress, fetchPage, cancel, discard };
}

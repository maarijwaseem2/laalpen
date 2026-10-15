import { forwardRef, useCallback, useRef, useState } from 'react';
import type { GestureResponderEvent, View } from 'react-native';
import { Button as PaperButton } from 'react-native-paper';

type Props = React.ComponentProps<typeof PaperButton>;

/**
 * The app's Button: react-native-paper's Button that can't be pressed twice.
 * - while `loading` is true it is disabled (Paper only shows a spinner and still fires onPress)
 * - if onPress returns a promise, further presses are ignored until it settles
 * - a second press within 600 ms is ignored (double-click / double-tap)
 * so one tap sends one request: no duplicate tests, uploads, approvals or publishes.
 */
export const Button = forwardRef<View, Props>(function Button({ onPress, loading, disabled, ...rest }, ref) {
  const busy = useRef(false);
  const last = useRef(0);
  const [pending, setPending] = useState(false);
  const handle = useCallback(
    (e: GestureResponderEvent) => {
      const now = Date.now();
      if (!onPress || busy.current || loading || now - last.current < 600) return;
      last.current = now;
      const r = (onPress as (e: GestureResponderEvent) => unknown)(e);
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        busy.current = true;
        setPending(true);
        (r as Promise<unknown>).finally(() => {
          busy.current = false;
          setPending(false);
        });
      }
    },
    [onPress, loading],
  );
  return <PaperButton ref={ref} {...rest} loading={loading || pending} disabled={disabled || loading || pending} onPress={onPress ? handle : undefined} />;
});

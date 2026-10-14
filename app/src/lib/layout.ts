import { useWindowDimensions } from 'react-native';

/** Phone (< 760px) uses bottom tabs; tablet/web uses the sidebar. */
export function useLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const cols = width >= 1280 ? 4 : width >= 980 ? 3 : width >= 560 ? 2 : 1;
  return { width, wide, cols, gutter: wide ? 28 : 16 };
}

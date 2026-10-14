import { Redirect, useLocalSearchParams } from 'expo-router';

/** QR on a student claim card: laalpen://claim?code=K7QP3MXA → sign-up with the card code filled in. */
export default function Claim() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: '/register', params: code ? { card: code } : {} }} />;
}

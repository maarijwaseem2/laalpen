import { Redirect } from 'expo-router';

/** Old link: parents now sign in on the main page (Parent / Student, email or mobile number + password). */
export default function ParentLogin() {
  return <Redirect href={{ pathname: '/login', params: { mode: 'family' } }} />;
}

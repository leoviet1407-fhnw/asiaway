import { redirect } from 'next/navigation';

/** The schedule is what an employee opens the app for. */
export default function StaffIndex() {
  redirect('/staff/schedule');
}

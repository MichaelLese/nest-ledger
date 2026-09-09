import { currentMember } from '../server/auth';
import OwnershipApp from './ownership-app';
export const dynamic = 'force-dynamic';
export default async function Home() {
  try { return <OwnershipApp member={await currentMember()} />; }
  catch { return <main><h1>Nest Ledger</h1><p role="alert">Household database unavailable. Please try again later.</p></main>; }
}

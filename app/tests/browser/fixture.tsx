import React from 'react';
import { createRoot } from 'react-dom/client';
import OwnershipApp from '../../src/app/ownership-app';
createRoot(document.getElementById('root')!).render(<OwnershipApp member="MICHAEL" />);

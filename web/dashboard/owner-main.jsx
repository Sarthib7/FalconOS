import React from 'react';
import { createRoot } from 'react-dom/client';
import OwnerDashboard from './OwnerDashboard.jsx';
import fontLicense from '../landing/assets/FONT-LICENSE.txt?url';
import './style.css';
import './owner.css';

createRoot(document.getElementById('root')).render(<><link rel="license" href={fontLicense} /><OwnerDashboard /></>);

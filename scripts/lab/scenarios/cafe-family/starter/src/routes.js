import home from './pages/home.js';
import menu from './pages/menu.js';
import reservations from './pages/reservations.js';
import contact from './pages/contact.js';
import hours from './pages/hours.js';

export const routes = [
  { path: '/', title: 'Home', page: home },
  { path: '/menu', title: 'Menu', page: menu },
  { path: '/reservations', title: 'Book', page: reservations },
  { path: '/contact', title: 'Contact', page: contact },
  { path: '/hours', title: 'Hours', page: hours },
];

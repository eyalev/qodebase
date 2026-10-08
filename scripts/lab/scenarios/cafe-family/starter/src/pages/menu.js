import { menu } from '../data/menu.js';
import { price } from '../lib/format.js';

export default () => `
  <h1>Menu</h1>
  <ul>
    ${menu.map((item) => `<li>${item.name}${item.vegan ? ' <small class="badge">vegan</small>' : ''} <span class="price">${price(item.price)}</span></li>`).join('')}
  </ul>
`;

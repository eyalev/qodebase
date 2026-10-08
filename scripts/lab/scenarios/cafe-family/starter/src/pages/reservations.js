export default () => `
  <h1>Book a table</h1>
  <p>Tables for up to 8 people. Call us or write below.</p>
  <form><label>Name <input name="name"></label> <label>Day <input type="date" name="day"></label> <label>People <input type="number" min="1" max="8" name="people"></label> <button>Book</button></form>
`;

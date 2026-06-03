/**
 * Populate a <select> filter element with category options, replacing any
 * previously rendered ones (first/placeholder option is preserved).
 *
 * @param {string} filterId  - id of the <select> element
 * @param {string[]} categories - sorted list of category values to render
 */
export function setFilterOptions(filterId, categories) {
  const filter = document.getElementById(filterId);
  const options = filter.querySelectorAll("option:not(:first-child)");
  options.forEach((opt) => opt.remove());
  for (const cat of categories) {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    filter.appendChild(option);
  }
}

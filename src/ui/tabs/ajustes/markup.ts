import { html, type SafeHtml } from "../../../core/html";
import { iconFor } from "../../icons";

/** HTML de Ajustes: Tienda (con pantallas y voz) y Usuarios/Sucursales/Respaldo. */
export function ajustesMarkup(): SafeHtml {
  return html`
    <div class="split">
      <article class="card">
        <section class="card-section">
          <div class="section-head">
            <h2>Tienda</h2>
            <p class="hint" id="storeOwnerHint" hidden>Solo el dueño puede modificar el nombre y el logo de la tienda.</p>
          </div>
          <form id="settingsForm" class="form">
            <label class="form-field">Nombre
              <input id="storeName" class="input" placeholder="Mi tienda">
            </label>
            <div class="form-field">Logo
              <div class="logo-field">
                <img id="logoPreview" class="logo-thumb hidden" alt="Logo actual">
                <label class="import-label" id="logoPick">${iconFor("upload")} Elegir imagen
                  <input id="logoFile" type="file" accept="image/*" aria-label="Elegir logo">
                </label>
                <button id="removeLogo" class="ghost danger" type="button">Quitar logo</button>
              </div>
            </div>
            <button id="saveStore" class="primary" type="submit">Guardar</button>
          </form>
        </section>

        <section id="panelsWrap" class="card-section">
          <div class="section-block">
            <div class="section-head">
              <h2>Pantallas del vendedor</h2>
              <p class="hint">Elige qué ve el usuario vendedor.</p>
            </div>
            <div id="vendorTabsSettings" class="checkbox-grid"></div>
          </div>

          <div id="adminTabsWrap" class="section-block">
            <div class="section-head">
              <h2>Pantallas del administrador</h2>
              <p class="hint">Elige qué ve el administrador. El dueño siempre ve todo.</p>
            </div>
            <div id="adminTabsSettings" class="checkbox-grid"></div>
          </div>
        </section>

        <section class="card-section">
          <p class="hint">La voz del asistente se activa desde el menú de tu usuario (arriba a la derecha).</p>
          <div id="voiceSettingsHost"></div>
          <button id="savePanels" class="primary" type="submit" form="settingsForm">Guardar</button>
        </section>
      </article>

      <article class="card">
        <section id="usersSection" class="card-section">
          <div class="section-title">
            <h2>Usuarios</h2>
            <button id="addUser" class="primary" type="button">Agregar</button>
          </div>
          <div id="usersList" class="list"></div>
        </section>

        <section id="branchesSection" class="card-section">
          <div class="section-title">
            <h2>Sucursales</h2>
            <button id="addBranch" class="primary" type="button">Agregar</button>
          </div>
          <p class="hint" id="branchesHint"></p>
          <div id="branchesList" class="list"></div>
        </section>

        <section class="card-section">
          <div class="section-head">
            <h2>Respaldo</h2>
            <p class="hint" id="syncInfo"></p>
          </div>
          <div class="backup-actions">
            <button id="syncNow" class="ghost" type="button">Sincronizar ahora</button>
            <button id="copySetupLink" class="ghost" type="button">Enlazar otro dispositivo</button>
            <button id="exportData" class="ghost" type="button">Exportar respaldo</button>
            <label class="import-label">Importar respaldo<input id="importData" type="file" accept="application/json"></label>
          </div>
        </section>
      </article>
    </div>
  `;
}

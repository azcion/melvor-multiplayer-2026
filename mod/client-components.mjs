export function register_components(runtime) {
	const {
		BankRangeSlider,
		createItemInformationTooltip,
		game,
		getLangString,
		modal_queue_guard,
		mount_modal_template,
		state,
		tippy,
	} = runtime;

	class MPModalComponent extends HTMLElement {
		constructor() {
			super();
			this.template_app = null;
			this.disconnect_waiters = [];
		}

		connectedCallback() {
			if (this.template_app !== null)
				return;

			const template_id = this.getAttribute('data-template-id');
			modal_queue_guard.release(template_id);
			this.template_app = mount_modal_template(template_id, this);
		}

		disconnectedCallback() {
			this.unmountTemplate();
			for (const resolve of this.disconnect_waiters)
				resolve();
			this.disconnect_waiters = [];
		}

		whenDisconnected() {
			if (!this.isConnected)
				return Promise.resolve();
			return new Promise(resolve => this.disconnect_waiters.push(resolve));
		}

		unmountTemplate() {
			if (this.template_app === null)
				return;
			this.template_app.unmount();
			this.template_app = null;
			this.replaceChildren();
		}
	}

	class LangStringFormattedElement extends HTMLElement {
		constructor() {
			super();
		}

		connectedCallback() {
			this.updateTranslation();
		}

		updateTranslation() {
			const lang_id = this.getAttribute('lang-id');

			if (lang_id === null) {
				this.textContent = getLangString('MOD_MP_LANGUAGE_ID_UNDEFINED');
				return;
			}

			let translated_string = getLangString(`${lang_id}`);

			const format_args = [];
			let i = 1;
			while (this.hasAttribute(`lang-arg-${i}`)) {
				format_args.push(this.getAttribute(`lang-arg-${i}`));
				i++;
			}

			if (format_args.length > 0)
				translated_string = this.formatString(translated_string, format_args);

			this.textContent = translated_string;
		}

		formatString(str, args) {
			return str.replace(/%s/g, () => args.shift() || '');
		}

		attributeChangedCallback(name, oldValue, newValue) {
			this.updateTranslation();
		}

		static get observedAttributes() {
			return ['lang-id', ...Array.from({length: 10}, (_, i) => `lang-arg-${i+1}`)];
		}
	}

	class MPItemIcon extends HTMLElement {
		constructor() {
			super();
		}

		createUnsupportedItemTooltip() {
			return `<div class="text-center">
					<div class="media d-flex align-items-center push">
						<div class="mr-3">
							<img class="bank-img m-1" src="assets/media/main/question.png">
						</div>
						<div class="media-body">
							<div class="font-w600 text-danger"><lang-string lang-id="MOD_MP_UNSUPPORTED_ITEM"></lang-string></div>
							<div role="separator" class="dropdown-divider m-0 mb-1"></div>
							<small class="text-info"><lang-string lang-id="MOD_MP_UNSUPPORTED_ITEM_INFO"></lang-string></small>
						</div>
					</div>
			</div>`;
		}

		createGPTooltip() {
			return `<div class="text-center">
					<div class="media d-flex align-items-center push">
						<div class="mr-3">
							<img class="bank-img m-1" src="assets/media/main/coins.png">
						</div>
						<div class="media-body">
							<div class="font-w600"><lang-string lang-id="MOD_MP_GP_NAME"></lang-string></div>
							<div role="separator" class="dropdown-divider m-0 mb-1"></div>
							<small class="text-info"><lang-string lang-id="MOD_MP_GP_INFO"></lang-string></small>
						</div>
					</div>
			</div>`;
		}

		connectedCallback() {
			const item_id = this.getAttribute('data-item-id');
			this.item = game.items.getObjectByID(item_id);

			this.tooltip = tippy(this, {
				content: '',
				placement: 'top',
				allowHTML: true,
				interactive: false,
				animation: false,
				touch: 'hold',
				onShow: (instance) => {
					if (item_id === 'melvorD:GP')
						instance.setContent(this.createGPTooltip());
					else if (this.item !== undefined)
						instance.setContent(createItemInformationTooltip(this.item));
					else
						instance.setContent(this.createUnsupportedItemTooltip());
				}
			});
		}

		disconnectedCallback() {
			this.tooltip?.destroy();
		}
	}

	class MPEquipmentItem extends HTMLElement {
		connectedCallback() {
			const item = game.items.getObjectByID(this.getAttribute('data-item-id'));
			if (item === undefined)
				return;
			this.tooltip = tippy(this, {
				content: '',
				placement: 'top',
				allowHTML: true,
				interactive: false,
				animation: false,
				touch: 'hold',
				onShow: instance => instance.setContent(createItemInformationTooltip(item))
			});
		}

		disconnectedCallback() {
			this.tooltip?.destroy();
		}
	}

	class MPGPSlider extends HTMLElement {
		constructor() {
			super();

			state.add_gp_value = 1;

			const $input = document.createElement('input');
			$input.type = 'text';

			this.appendChild($input);

			this.slider = new BankRangeSlider($input);

			this.slider.sliderMax = game.gp.amount;
			this.slider.sliderMin = 1;

			this.slider.sliderInstance.update({
				min: 1,
				max: game.gp.amount
			});

			const $value = document.createElement('input');
			$value.classList.add('form-control', 'mt-2');
			$value.type = 'number';
			$value.value = 1;

			$value.addEventListener('input', () => this.slider.setSliderPosition($value.value));
			this.slider.customOnChange = (amount) => {
				$value.value = amount;
				state.add_gp_value = amount;
			};

			this.appendChild($value);
		}

		disconnectedCallback() {
			this.slider?.sliderInstance?.destroy();
			this.slider = null;
		}
	}

	class MPItemSlider extends HTMLElement {
		constructor() {
			super();

			const max = this.getMax();
			state.item_slider_value = 0;

			const $input = document.createElement('input');
			$input.type = 'text';

			this.appendChild($input);

			this.slider = new BankRangeSlider($input);

			this.slider.sliderMax = max;
			this.slider.sliderMin = 0;

			this.slider.sliderInstance.update({
				min: 0,
				max
			});

			const $value = document.createElement('input');
			$value.classList.add('form-control', 'mt-2');
			$value.type = 'number';
			$value.value = 0;

			$value.addEventListener('input', () => this.slider.setSliderPosition($value.value));
			this.slider.customOnChange = (amount) => {
				$value.value = amount;
				state.item_slider_value = amount;
			};

			this.appendChild($value);
		}

		getMax() {
			const item_id = this.getAttribute('data-item-id');
			return parseInt(this.getAttribute('data-max') ?? game.bank.getQty(game.items.getObjectByID(item_id)));
		}

		set_max() {
			this.slider?.setSliderPosition(Infinity);
		}

		attributeChangedCallback(name, oldValue, newValue) {
			if (this.slider === null)
				return;

			const max = this.getMax();

			this.slider.sliderMax = max;
			this.slider.sliderMin = 0;

			this.slider.sliderInstance.update({
				min: 0,
				max: max
			});
		}

		static get observedAttributes() {
			return ['data-item-id', 'data-max'];
		}

		disconnectedCallback() {
			this.slider?.sliderInstance?.destroy();
			this.slider = null;
		}
	}

	window.customElements.define('mp-lang-string-f', LangStringFormattedElement);
	window.customElements.define('mp-modal-component', MPModalComponent);
	window.customElements.define('mp-item-icon', MPItemIcon);
	window.customElements.define('mp-equipment-item', MPEquipmentItem);
	window.customElements.define('mp-gp-slider', MPGPSlider);
	window.customElements.define('mp-item-slider', MPItemSlider);
}

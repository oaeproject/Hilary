exports.createNewTenantConfig = {
    "rows": [
        {
            "element": "form",
            "action": "/createtenant",
            "method": "post",
            "elements": [{
                "element": "header",
                "type": "h1",
                "label": "Create a new tenant"
            }, {
                "element": "label",
                "label": "ID:",
                "for": "tenant_id"
            }, {
                "element": "input",
                "id": "tenant_id",
                "name": "id"
            }, {
                "element": "label",
                "label": "Name:",
                "for": "tenant_name"
            }, {
                "element": "input",
                "id": "tenant_name",
                "name": "name"
            }, {
                "element": "label",
                "label": "Port:",
                "for": "tenant_port"
            }, {
                "element": "input",
                "id": "tenant_port",
                "name": "port"
            }, {
                "element": "button",
                "type": "submit",
                "label": "Create tenant"
            }]
        }
    ]
};